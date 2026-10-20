import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { evaluate, parseExpr, type Decision, type DecisionQuestion } from "@kiln/schema";
import * as z from "zod/v4";

/** Choice questions answer with a probability per option; probability and score questions with one number. */
export type Answer = number | Record<string, number>;
export type Answers = Record<string, Answer>;

export type DecisionRequest = {
  decision: string;
  state: Record<string, unknown>;
  questions: Record<string, DecisionQuestion>;
  timeoutMs: number;
};

export interface DecisionProvider {
  readonly name: string;
  ask(request: DecisionRequest): Promise<Answers>;
}

export class DecisionTimeout extends Error {
  constructor(provider: string, ms: number) {
    super(`${provider} did not answer within ${ms} ms`);
  }
}

async function withTimeout<T>(provider: string, ms: number, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new DecisionTimeout(provider, ms));
    }, ms);
  });
  try {
    return await Promise.race([fn(controller.signal), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function normalize(questions: Record<string, DecisionQuestion>, raw: Record<string, unknown>): Answers {
  const out: Answers = {};
  for (const [name, q] of Object.entries(questions)) {
    const v = raw[name] as Record<string, unknown> | number | undefined;
    if (q.type === "choice") {
      const probs = (typeof v === "object" && v ? ((v.probabilities as Record<string, number>) ?? v) : {}) as Record<string, number>;
      out[name] = Object.fromEntries(q.options.map((o) => [o, Number(probs[o] ?? 0)]));
    } else {
      const o = v as Record<string, unknown> | undefined;
      const n = typeof v === "number" ? v : Number(o?.probability ?? o?.noul ?? o?.score ?? 0);
      out[name] = Number.isFinite(n) ? n : 0;
    }
  }
  return out;
}

const JEV_URL = "https://api.typesafe.ai";
/** Levels Kiln's numeric score questions are asked on; Jev answers with the expected level index. */
const SCORE_LEVELS = ["very low", "low", "medium", "high", "very high"];
const words = (s: string) => s.replace(/[-_]+/g, " ").trim();

/** One Kiln question as a Jev question: choice → choice, probability → noul, score → score on SCORE_LEVELS. */
function jevQuestion(decision: string, name: string, q: DecisionQuestion) {
  const instructions = `${words(decision)}: ${words(name)}`;
  if (q.type === "choice") return { type: "choice", instructions, criteria: Object.fromEntries(q.options.map((o) => [o, words(o)])) };
  if (q.type === "probability") return { type: "noul", instructions };
  return { type: "score", instructions, criteria: SCORE_LEVELS };
}

/**
 * TypeSafe AI's Jev (POST https://api.typesafe.ai/v1/systemone): typed questions over program
 * state, answered in one parallel call. This adapter is the only place that knows the wire format.
 */
export class JevProvider implements DecisionProvider {
  readonly name = "jev";

  constructor(
    private readonly options: { apiKey: string; baseUrl?: string; model?: string; fetch?: typeof fetch; redact?: (s: Record<string, unknown>) => Record<string, unknown> },
  ) {}

  /** The base URL or the full endpoint both work. */
  private endpoint() {
    const base = (this.options.baseUrl || JEV_URL).replace(/\/+$/, "");
    return base.endsWith("/v1/systemone") ? base : `${base}/v1/systemone`;
  }

  async ask(request: DecisionRequest): Promise<Answers> {
    const doFetch = this.options.fetch ?? fetch;
    const state = this.options.redact ? this.options.redact(request.state) : request.state;
    return withTimeout(this.name, request.timeoutMs, async (signal) => {
      const res = await doFetch(this.endpoint(), {
        method: "POST",
        signal,
        headers: { "content-type": "application/json", authorization: `Bearer ${this.options.apiKey}` },
        body: JSON.stringify({
          model: this.options.model ?? "jev-latest",
          state,
          questions: Object.fromEntries(Object.entries(request.questions).map(([name, q]) => [name, jevQuestion(request.decision, name, q)])),
        }),
      });
      if (!res.ok) throw new Error(`jev returned ${res.status}`);
      const body = (await res.json()) as { answers?: Record<string, Record<string, unknown>> };
      const answers: Record<string, unknown> = { ...body.answers };
      for (const [name, q] of Object.entries(request.questions)) {
        const score = Number(body.answers?.[name]?.score);
        if (q.type === "score" && Number.isFinite(score)) answers[name] = q.min + (score / (SCORE_LEVELS.length - 1)) * (q.max - q.min);
      }
      return normalize(request.questions, answers);
    });
  }
}

/** The answer schema Claude fills in for one decision: probabilities per choice option, numbers otherwise. */
function answerSchema(questions: Record<string, DecisionQuestion>) {
  return z.object(
    Object.fromEntries(Object.entries(questions).map(([name, q]) => [name, q.type === "choice" ? z.object(Object.fromEntries(q.options.map((o) => [o, z.number()]))) : z.number()])),
  );
}

/**
 * Claude (Haiku by default) answering decisions with structured output: what Kiln uses without Jev
 * or a gateway, from the ANTHROPIC_API_KEY agents already have.
 */
export class AnthropicProvider implements DecisionProvider {
  readonly name = "anthropic";
  private readonly client: Anthropic;

  constructor(private readonly options: { apiKey: string; model?: string; fetch?: typeof fetch }) {
    this.client = new Anthropic({ apiKey: options.apiKey, maxRetries: 1, ...(options.fetch ? { fetch: options.fetch } : {}) });
  }

  async ask(request: DecisionRequest): Promise<Answers> {
    const prompt = [
      `Answer each typed question about the state below for the "${request.decision}" decision.`,
      "For choice questions give a probability per option that sums to 1; for probability questions a number from 0 to 1; for score questions a number in the stated range.",
      `Questions: ${JSON.stringify(request.questions)}`,
      `State: ${JSON.stringify(request.state)}`,
    ].join("\n");
    return withTimeout(this.name, Math.max(request.timeoutMs, 15_000), async (signal) => {
      const res = await this.client.messages.parse(
        {
          model: this.options.model ?? "claude-haiku-5-5",
          max_tokens: 4096,
          output_config: { effort: "low", format: zodOutputFormat(answerSchema(request.questions)) },
          messages: [{ role: "user", content: prompt }],
        },
        { signal },
      );
      if (res.stop_reason === "refusal") throw new Error(`${this.options.model ?? "claude-haiku-5-5"} refused to answer`);
      if (!res.parsed_output) throw new Error(`no structured answer (stop reason ${res.stop_reason})`);
      return normalize(request.questions, res.parsed_output as Record<string, unknown>);
    });
  }
}

/** Structured output from any OpenAI-compatible gateway (LiteLLM, Bedrock, Vertex behind it). */
export class LlmProvider implements DecisionProvider {
  readonly name = "llm";

  constructor(private readonly options: { baseUrl: string; apiKey: string; model: string; fetch?: typeof fetch }) {}

  async ask(request: DecisionRequest): Promise<Answers> {
    const doFetch = this.options.fetch ?? fetch;
    const prompt = [
      "Answer each typed question about the state below. Reply with JSON only.",
      "For choice questions give a probability per option that sums to 1; for probability questions a number 0..1.",
      `Questions: ${JSON.stringify(request.questions)}`,
      `State: ${JSON.stringify(request.state)}`,
    ].join("\n");
    return withTimeout(this.name, Math.max(request.timeoutMs, 15_000), async (signal) => {
      const res = await doFetch(`${this.options.baseUrl.replace(/\/$/, "")}/v1/chat/completions`, {
        method: "POST",
        signal,
        headers: { "content-type": "application/json", authorization: `Bearer ${this.options.apiKey}` },
        body: JSON.stringify({
          model: this.options.model,
          response_format: { type: "json_object" },
          messages: [{ role: "user", content: prompt }],
        }),
      });
      if (!res.ok) throw new Error(`llm gateway returned ${res.status}`);
      const body = (await res.json()) as { choices: { message: { content: string } }[] };
      return normalize(request.questions, JSON.parse(body.choices[0]?.message.content ?? "{}"));
    });
  }
}

export type FakeRule = (request: DecisionRequest) => Answers | undefined;

/** Deterministic provider for tests and offline dev. Rules run in order; the first answer wins. */
export class FakeProvider implements DecisionProvider {
  readonly name = "fake";
  readonly calls: DecisionRequest[] = [];

  constructor(
    private readonly rules: FakeRule[] = [heuristicRule],
    private readonly delayMs = 0,
  ) {}

  async ask(request: DecisionRequest): Promise<Answers> {
    this.calls.push(request);
    return withTimeout(this.name, request.timeoutMs, async () => {
      if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
      for (const rule of this.rules) {
        const a = rule(request);
        if (a) return normalize(request.questions, a);
      }
      return normalize(request.questions, {});
    });
  }
}

const DESTRUCTIVE = [/\brm\s+-[a-z]*r[a-z]*f?\s+(\/|~|\*|\.)/, /\bmkfs\b/, /\bdd\s+if=/, /git\s+push\s+.*--force.*\b(main|master)\b/, /\bdrop\s+(database|table)\b/i, /kubectl\s+delete\s+.*\b(prod|production)\b/];
const RISKY = [/\bgit\s+push\b/, /\bnpm\s+publish\b/, /\bcurl\b.*\|\s*(sh|bash)/, /\bchmod\s+-R\b/, /\bsudo\b/, /\brm\s+-/];
const REMOTE = [/\bssh\b/, /\bcurl\b.*\|\s*(sh|bash)/, /\bkubectl\b/, /\bterraform\s+apply\b/];

/** Transparent heuristics so every built-in decision works offline (dev mode and tests). */
export function heuristicRule(request: DecisionRequest): Answers | undefined {
  const st = request.state;
  const text = `${st.title ?? ""}\n${st.body ?? ""}`;
  const bullets = (String(st.body ?? "").match(/^\s*[-*]\s+/gm) ?? []).length;
  const sizeOf = () => {
    if (/\b(large|epic|redesign|platform|migration|rewrite)\b/i.test(text)) return "l";
    if (bullets > 5) return "l";
    if (bullets >= 2) return "m";
    if (/\b(typo|copy|rename|bump|flag)\b/i.test(text) && text.length < 200) return "xs";
    return "s";
  };
  const choice = (options: string[], pick: string, p = 0.85) => Object.fromEntries(options.map((o) => [o, o === pick ? p : (1 - p) / (options.length - 1)]));
  switch (request.decision) {
    case "command-guard":
    case undefined:
      break;
    case "triage": {
      const kind = /\b(bug|fix|crash|error|broken|regression|typo)\b/i.test(text) ? "bug" : /\b(chore|bump|upgrade|rename)\b/i.test(text) ? "chore" : /\?\s*$/.test(String(st.title ?? "")) ? "question" : "feature";
      return { kind: choice(["feature", "bug", "chore", "incident", "question"], kind), size: choice(["xs", "s", "m", "l", "xl"], sizeOf()), duplicate_of_recent: 0.05 };
    }
    case "foreman-routing": {
      const size = String(st.size ?? sizeOf());
      return { next_stage: choice(["triage", "plan", "build", "review", "handoff"], "build", 0.6), needs_spec: ["m", "l", "xl"].includes(size) ? 0.9 : ["xs", "s"].includes(size) ? 0.05 : 0.5, needs_human: 0.05 };
    }
    case "spec-check": {
      const vague = /\b(fast|nice|good|better|intuitive|user-friendly|etc|somehow|maybe|properly|robust)\b/i.test(String(st.criterion ?? ""));
      return { is_testable: vague ? 0.3 : 0.9, is_ambiguous: vague ? 0.7 : 0.1 };
    }
    case "review-risk": {
      const files = Array.isArray(st.files) ? st.files.join("\n") : "";
      const high = /\b(auth|login|payment|billing|security|secret|migrations?|delete)\b/i.test(`${text}\n${files}`);
      return { risk_tier: choice(["low", "medium", "high"], high ? "high" : "low", 0.8), touches_sensitive_area: high ? 0.8 : 0.1 };
    }
    case "model-router": {
      const size = sizeOf();
      return { complexity: choice(["easy", "medium", "hard"], size === "xs" || size === "s" ? "easy" : size === "l" ? "hard" : "medium") };
    }
    case "failure-category":
      return { failure_category: choice(["instructions", "skills", "tooling", "model", "app_code", "flaky"], /flak|timeout/i.test(String(st.summary ?? "")) ? "flaky" : "instructions", 0.8) };
    case "inbox-urgency":
      return { urgency: st.kind === "question" ? 0.85 : st.kind === "merge" ? 0.4 : 0.6 };
    default:
      return undefined;
  }
  const command = String(st.command ?? "");
  if (!command) return undefined;
  const destructive = DESTRUCTIVE.some((r) => r.test(command));
  const risky = !destructive && RISKY.some((r) => r.test(command));
  return {
    risk_level: { safe: destructive || risky ? 0.05 : 0.95, risky: risky ? 0.85 : 0.04, destructive: destructive ? 0.92 : 0.01 },
    remote_exec: REMOTE.some((r) => r.test(command)) ? 0.85 : 0.02,
    deletes_files: /\brm\b/.test(command) ? 0.9 : 0.02,
    touches_prod: /\bprod(uction)?\b/.test(command) ? 0.9 : 0.02,
  };
}

export type DecisionOutcome = {
  decision: string;
  action: string;
  answers: Answers;
  provider: string;
  fellBack: boolean;
  error?: string;
  latencyMs: number;
};

/** Evaluate a decision: ask the provider, fall back as configured, then apply the policy in order. */
export async function runDecision(
  name: string,
  def: Decision,
  state: Record<string, unknown>,
  providers: { primary: DecisionProvider; fallback?: DecisionProvider },
  log?: (outcome: DecisionOutcome & { state: Record<string, unknown> }) => void,
): Promise<DecisionOutcome> {
  const picked = Object.fromEntries(def.state.map((k) => [k, state[k]]));
  const request: DecisionRequest = { decision: name, state: picked, questions: def.questions, timeoutMs: def.timeout_ms };
  const started = Date.now();
  let answers: Answers | undefined;
  let provider = providers.primary.name;
  let fellBack = false;
  let error: string | undefined;
  try {
    answers = await providers.primary.ask(request);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
    if (def.on_error === "llm" && providers.fallback) {
      fellBack = true;
      provider = providers.fallback.name;
      try {
        answers = await providers.fallback.ask({ ...request, timeoutMs: Math.max(request.timeoutMs, 15_000) });
      } catch (e2) {
        error = `${error}; fallback: ${e2 instanceof Error ? e2.message : String(e2)}`;
      }
    }
  }
  let action: string;
  if (!answers) {
    // No answer at all: fail closed for "deny" and "llm" (fallback also failed), open for "allow".
    action = def.on_error === "allow" ? "allow" : (Object.keys(def.policy)[0] ?? "deny");
    answers = {};
  } else {
    action = "allow";
    const ctx = { ...picked, ...answers };
    for (const [act, src] of Object.entries(def.policy)) {
      if (evaluate(parseExpr(src), ctx)) {
        action = act;
        break;
      }
    }
  }
  const outcome = { decision: name, action, answers, provider, fellBack, error, latencyMs: Date.now() - started };
  log?.({ ...outcome, state: picked });
  return outcome;
}

/** Built-in decisions used when a factory has no decisions/<name>.yaml of its own. */
export const BUILTIN_DECISIONS: Record<string, Decision> = {
  "command-guard": {
    provider: "jev",
    state: ["command", "cwd", "repo", "branch"],
    questions: {
      risk_level: { type: "choice", options: ["safe", "risky", "destructive"] },
      remote_exec: { type: "probability" },
      deletes_files: { type: "probability" },
      touches_prod: { type: "probability" },
    },
    policy: {
      block: "risk_level.destructive >= 0.8 or remote_exec >= 0.8 or touches_prod >= 0.8",
      ask_human: "risk_level.risky >= 0.3 or risk_level.destructive >= 0.3",
    },
    on_error: "llm",
    timeout_ms: 800,
  },
  "foreman-routing": {
    provider: "jev",
    state: ["stage", "kind", "size", "has_spec", "title", "body"],
    questions: {
      next_stage: { type: "choice", options: ["triage", "plan", "build", "review", "handoff"] },
      needs_spec: { type: "probability" },
      needs_human: { type: "probability" },
    },
    policy: { ask_human: "needs_human >= 0.85", skip_spec: "needs_spec <= 0.15" },
    on_error: "llm",
    timeout_ms: 800,
  },
  triage: {
    provider: "jev",
    state: ["title", "body", "recent_titles"],
    questions: {
      kind: { type: "choice", options: ["feature", "bug", "chore", "incident", "question"] },
      size: { type: "choice", options: ["xs", "s", "m", "l", "xl"] },
      duplicate_of_recent: { type: "probability" },
    },
    policy: { duplicate: "duplicate_of_recent >= 0.85" },
    on_error: "llm",
    timeout_ms: 800,
  },
  "spec-check": {
    provider: "jev",
    state: ["criterion"],
    questions: { is_testable: { type: "probability" }, is_ambiguous: { type: "probability" } },
    policy: { reject: "is_testable < 0.5 or is_ambiguous >= 0.5" },
    on_error: "llm",
    timeout_ms: 800,
  },
  "review-risk": {
    provider: "jev",
    state: ["files", "additions", "deletions", "title"],
    questions: {
      risk_tier: { type: "choice", options: ["low", "medium", "high"] },
      touches_sensitive_area: { type: "probability" },
    },
    // First match wins; with no answer the first action applies, so a failed check never skips review.
    policy: { code_owners: "risk_tier.high >= 0.5 or touches_sensitive_area >= 0.7", skip_review: "risk_tier.low >= 0.8 and touches_sensitive_area < 0.3" },
    on_error: "llm",
    timeout_ms: 800,
  },
  "model-router": {
    provider: "jev",
    state: ["title", "body", "files"],
    questions: { complexity: { type: "choice", options: ["easy", "medium", "hard"] } },
    policy: { easy: "complexity.easy >= 0.8", hard: "complexity.hard >= 0.6" },
    on_error: "llm",
    timeout_ms: 800,
  },
  "failure-category": {
    provider: "jev",
    state: ["agent", "label", "summary"],
    questions: {
      failure_category: { type: "choice", options: ["instructions", "skills", "tooling", "model", "app_code", "flaky"] },
    },
    policy: {},
    on_error: "llm",
    timeout_ms: 800,
  },
  "inbox-urgency": {
    provider: "jev",
    state: ["kind", "title", "age_hours"],
    questions: { urgency: { type: "score", min: 0, max: 1 } },
    policy: { urgent: "urgency >= 0.8" },
    on_error: "llm",
    timeout_ms: 800,
  },
};

/** Pick the highest-probability option of a choice answer. */
export function top(answer: Answer | undefined): { option: string; p: number } | undefined {
  if (!answer || typeof answer === "number") return undefined;
  const [option, p] = Object.entries(answer).sort((a, b) => b[1] - a[1])[0] ?? [];
  return option === undefined ? undefined : { option, p: p! };
}

export type GuardVerdict = "allow" | "ask_human" | "block";

/** The sandbox pre-exec hook: every shell command is checked before it runs. */
export async function guardCommand(
  command: string,
  context: { cwd?: string; repo?: string; branch?: string },
  providers: { primary: DecisionProvider; fallback?: DecisionProvider },
  def: Decision = BUILTIN_DECISIONS["command-guard"]!,
  log?: Parameters<typeof runDecision>[4],
): Promise<{ verdict: GuardVerdict; outcome: DecisionOutcome }> {
  const outcome = await runDecision("command-guard", def, { command, ...context }, providers, log);
  const verdict: GuardVerdict = outcome.action === "block" ? "block" : outcome.action === "ask_human" ? "ask_human" : "allow";
  return { verdict, outcome };
}
