import { describe, expect, it } from "vitest";
import { AnthropicProvider, BUILTIN_DECISIONS, FakeProvider, guardCommand, JevProvider, runDecision, top, type DecisionProvider } from "./index";

const llm = new FakeProvider();

describe("command guardrail", () => {
  it("blocks a destructive command", async () => {
    const { verdict } = await guardCommand("rm -rf / --no-preserve-root", {}, { primary: new FakeProvider(), fallback: llm });
    expect(verdict).toBe("block");
  });

  it("asks a human about a risky command", async () => {
    const { verdict } = await guardCommand("git push origin kiln/feature", {}, { primary: new FakeProvider() });
    expect(verdict).toBe("ask_human");
  });

  it("allows a safe command", async () => {
    const { verdict } = await guardCommand("pnpm test", {}, { primary: new FakeProvider() });
    expect(verdict).toBe("allow");
  });

  it("falls back to the LLM path when Jev times out", async () => {
    const slowJev = new FakeProvider(undefined, 50);
    const fallback = new FakeProvider();
    const logs: unknown[] = [];
    const def = { ...BUILTIN_DECISIONS["command-guard"]!, timeout_ms: 10 };
    const { verdict, outcome } = await guardCommand("rm -rf ~", {}, { primary: slowJev, fallback }, def, (o) => logs.push(o));
    expect(verdict).toBe("block");
    expect(outcome).toMatchObject({ fellBack: true, provider: "fake" });
    expect(outcome.error).toContain("did not answer within 10 ms");
    expect(fallback.calls).toHaveLength(1);
    expect(logs).toHaveLength(1);
  });

  it("lets the agent work on when the guard is only unsure, and asks once risky is at least as likely as not", async () => {
    const answering = (risky: number): DecisionProvider => ({
      name: "unsure",
      ask: async () => ({ risk_level: { safe: 1 - risky, risky, destructive: 0 }, remote_exec: 0, deletes_files: 0, touches_prod: 0 }),
    });
    expect((await guardCommand("python3 - <<'E'\nopen('a.tsx','w')\nE", {}, { primary: answering(0.35) })).verdict).toBe("allow");
    expect((await guardCommand("git push origin kiln/feature", {}, { primary: answering(0.5) })).verdict).toBe("ask_human");
  });

  it("tells the provider what the guard decides: a sandbox, where workspace edits are safe", async () => {
    const provider = new FakeProvider();
    await guardCommand("ls", {}, { primary: provider });
    expect(provider.calls[0]!.description).toMatch(/sandbox/i);
  });

  it("fails closed when every provider fails", async () => {
    const broken: DecisionProvider = { name: "broken", ask: async () => Promise.reject(new Error("down")) };
    const { verdict } = await guardCommand("ls", {}, { primary: broken, fallback: broken });
    expect(verdict).toBe("block");
  });
});

describe("Jev adapter", () => {
  /** A Jev that answers like api.typesafe.ai/v1/systemone (docs.typesafe.ai quickstart). */
  const jevAt = (answers: Record<string, unknown>, seen: { url?: string; body?: Record<string, any>; auth?: string } = {}) =>
    (async (url: string, init: RequestInit) => {
      seen.url = url;
      seen.body = JSON.parse(String(init.body));
      seen.auth = (init.headers as Record<string, string>).authorization;
      return new Response(JSON.stringify({ model: "jev-1.13.0", answers, usage: { input_tokens: 10, output_tokens: 2 } }));
    }) as unknown as typeof fetch;

  it("posts typed questions to /v1/systemone and normalizes answers", async () => {
    const seen: { url?: string; body?: Record<string, any>; auth?: string } = {};
    const jev = new JevProvider({
      apiKey: "k",
      redact: (s) => ({ ...s, secret: "[redacted]" }),
      fetch: jevAt({ kind: { type: "choice", choice: "bug", probabilities: { bug: 0.9, feature: 0.1 }, confidence: 0.8 }, duplicate_of_recent: { type: "noul", noul: 0.2 } }, seen),
    });
    const outcome = await runDecision("triage", BUILTIN_DECISIONS.triage!, { title: "Crash", secret: "x" }, { primary: jev });
    expect(seen.url).toBe("https://api.typesafe.ai/v1/systemone");
    expect(seen.auth).toBe("Bearer k");
    expect(seen.body).toMatchObject({ model: "jev-latest", state: { title: "Crash", secret: "[redacted]" } });
    expect(seen.body!.questions.kind).toMatchObject({ type: "choice", criteria: { bug: expect.any(String), feature: expect.any(String) } });
    expect(seen.body!.questions.kind.instructions).toEqual(expect.any(String));
    expect(seen.body!.questions.duplicate_of_recent).toMatchObject({ type: "noul" });
    expect(top(outcome.answers.kind)).toEqual({ option: "bug", p: 0.9 });
    expect(outcome.answers.duplicate_of_recent).toBe(0.2);
  });

  it("accepts the base URL or the full endpoint, and maps scores onto the question's range", async () => {
    const seen: { url?: string; body?: Record<string, any> } = {};
    const questions = { urgency: { type: "score" as const, min: 0, max: 1 } };
    const levels = 5;
    for (const baseUrl of ["https://api.typesafe.ai", "https://api.typesafe.ai/v1/systemone/"]) {
      const jev = new JevProvider({ baseUrl, apiKey: "k", fetch: jevAt({ urgency: { type: "score", score: 3, probabilities: {}, confidence: 1 } }, seen) });
      const answers = await jev.ask({ decision: "inbox-urgency", state: { kind: "question" }, questions, timeoutMs: 1000 });
      expect(seen.url).toBe("https://api.typesafe.ai/v1/systemone");
      expect(seen.body!.questions.urgency.criteria).toHaveLength(levels);
      expect(answers.urgency).toBeCloseTo(3 / (levels - 1));
    }
  });

  it("puts the decision's description in front of every question", async () => {
    const seen: { body?: Record<string, any> } = {};
    const jev = new JevProvider({ apiKey: "k", fetch: jevAt({}, seen) });
    await runDecision("command-guard", BUILTIN_DECISIONS["command-guard"]!, { command: "ls" }, { primary: jev });
    expect(seen.body!.questions.risk_level.instructions).toContain("disposable sandbox");
    expect(seen.body!.questions.risk_level.instructions).toContain("command guard: risk level");
  });

  it("fails with the status so the decision falls back", async () => {
    const jev = new JevProvider({ apiKey: "bad", fetch: (async () => new Response("unauthorized", { status: 401 })) as unknown as typeof fetch });
    await expect(jev.ask({ decision: "triage", state: {}, questions: BUILTIN_DECISIONS.triage!.questions, timeoutMs: 1000 })).rejects.toThrow("jev returned 401");
  });
});

describe("Anthropic provider", () => {
  it("asks Claude Haiku for typed answers with structured output", async () => {
    let body: Record<string, any> | undefined;
    const provider = new AnthropicProvider({
      apiKey: "sk-test",
      fetch: (async (_url: string, init: RequestInit) => {
        body = JSON.parse(String(init.body));
        const answer = { risk_level: { safe: 0.9, risky: 0.08, destructive: 0.02 }, remote_exec: 0.01, deletes_files: 0.7, touches_prod: 0 };
        return new Response(
          JSON.stringify({ id: "msg_1", type: "message", role: "assistant", model: "claude-haiku-5-5", content: [{ type: "text", text: JSON.stringify(answer) }], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 5, output_tokens: 5 } }),
          { headers: { "content-type": "application/json" } },
        );
      }) as unknown as typeof fetch,
    });
    const { verdict } = await guardCommand("rm -rf node_modules", {}, { primary: provider });
    expect(verdict).toBe("allow");
    expect(body).toMatchObject({ model: "claude-haiku-5-5", output_config: { format: { type: "json_schema" } } });
    expect(JSON.stringify(body!.messages)).toContain("rm -rf node_modules");
    expect(JSON.stringify(body!.messages)).toContain("disposable sandbox");
  });

  it("throws on a refusal so the decision fails closed", async () => {
    const provider = new AnthropicProvider({
      apiKey: "sk-test",
      fetch: (async () =>
        new Response(JSON.stringify({ id: "msg_2", type: "message", role: "assistant", model: "claude-haiku-5-5", content: [], stop_reason: "refusal", stop_sequence: null, usage: { input_tokens: 5, output_tokens: 0 } }), {
          headers: { "content-type": "application/json" },
        })) as unknown as typeof fetch,
    });
    await expect(provider.ask({ decision: "command-guard", state: { command: "x" }, questions: BUILTIN_DECISIONS["command-guard"]!.questions, timeoutMs: 1000 })).rejects.toThrow(/refus/);
  });
});
