import { describe, expect, it } from "vitest";
import { BUILTIN_DECISIONS, FakeProvider, guardCommand, JevProvider, runDecision, top, type DecisionProvider } from "./index";

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

  it("fails closed when every provider fails", async () => {
    const broken: DecisionProvider = { name: "broken", ask: async () => Promise.reject(new Error("down")) };
    const { verdict } = await guardCommand("ls", {}, { primary: broken, fallback: broken });
    expect(verdict).toBe("block");
  });
});

describe("Jev adapter", () => {
  it("sends typed questions and normalizes answers", async () => {
    let sent: { url: string; body: unknown } | undefined;
    const jev = new JevProvider({
      baseUrl: "https://jev.example/",
      apiKey: "k",
      redact: (s) => ({ ...s, secret: "[redacted]" }),
      fetch: (async (url: string, init: RequestInit) => {
        sent = { url, body: JSON.parse(String(init.body)) };
        return new Response(JSON.stringify({ answers: { kind: { probabilities: { bug: 0.9, feature: 0.1 } }, duplicate_of_recent: { probability: 0.2 } } }));
      }) as unknown as typeof fetch,
    });
    const outcome = await runDecision("triage", BUILTIN_DECISIONS.triage!, { title: "Crash", secret: "x" }, { primary: jev });
    expect(sent?.url).toBe("https://jev.example/v1/decide");
    expect(top(outcome.answers.kind)).toEqual({ option: "bug", p: 0.9 });
    expect(outcome.action).toBe("allow");
  });
});
