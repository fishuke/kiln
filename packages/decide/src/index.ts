import { evaluate, parseExpr, type Decision, type DecisionQuestion } from "@kiln/schema";

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
      const n = typeof v === "number" ? v : Number((v as Record<string, unknown> | undefined)?.probability ?? (v as Record<string, unknown> | undefined)?.score ?? 0);
      out[name] = Number.isFinite(n) ? n : 0;
    }
  }
  return out;
}

/**
 * TypeSafe AI's Jev: typed questions over program state, answered in one parallel call.
 * The wire format follows the early-access API; keep this adapter as the only place that knows it.
 */
export class JevProvider implements DecisionProvider {
  readonly name = "jev";

  constructor(
    private readonly options: { baseUrl: string; apiKey: string; fetch?: typeof fetch; redact?: (s: Record<string, unknown>) => Record<string, unknown> },
  ) {}

  async ask(request: DecisionRequest): Promise<Answers> {
    const doFetch = this.options.fetch ?? fetch;
    const state = this.options.redact ? this.options.redact(request.state) : request.state;
    return withTimeout(this.name, request.timeoutMs, async (signal) => {
      const res = await doFetch(`${this.options.baseUrl.replace(/\/$/, "")}/v1/decide`, {
        method: "POST",
        signal,
        headers: { "content-type": "application/json", authorization: `Bearer ${this.options.apiKey}` },
        body: JSON.stringify({
          state,
          questions: Object.entries(request.questions).map(([name, q]) => ({ name, ...q })),
        }),
      });
      if (!res.ok) throw new Error(`jev returned ${res.status}`);
      const body = (await res.json()) as { answers?: Record<string, unknown> };
      return normalize(request.questions, body.answers ?? {});
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

type FakeRule = (request: DecisionRequest) => Answers | undefined;

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

/** A transparent regex heuristic, used by FakeProvider in dev so the guardrail works offline. */
export function heuristicRule(request: DecisionRequest): Answers | undefined {
  const command = String(request.state.command ?? "");
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
    policy: { code_owners: "risk_tier.high >= 0.5 or touches_sensitive_area >= 0.7" },
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
