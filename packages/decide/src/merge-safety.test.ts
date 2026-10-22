import { describe, expect, it } from "vitest";
import { BUILTIN_DECISIONS, FakeProvider, JevProvider, runDecision, type DecisionProvider } from "./index";

const def = BUILTIN_DECISIONS["merge-safety"]!;

/** What the merge gate sends for a small, green copy change. */
const copyChange = {
  title: "Change the hero heading",
  author: "ana@acme.test",
  files: ["app/page.tsx"],
  areas: ["app/page.tsx"],
  additions: 2,
  deletions: 1,
  diff: "@@ -1,3 +1,3 @@\n-<h1>Welcome</h1>\n+<h1>Welcome back</h1>",
  checks: "success",
  tests: "passed",
  preview: "ready",
  findings: [],
};

const decide = (state: Record<string, unknown>, providers: { primary: DecisionProvider; fallback?: DecisionProvider } = { primary: new FakeProvider() }) =>
  runDecision("merge-safety", def, state, providers);

describe("merge-safety decision", () => {
  it("merges a small change with green checks offline", async () => {
    expect((await decide(copyChange)).action).toBe("merge");
  });

  it("sends a change with failing checks to review", async () => {
    expect((await decide({ ...copyChange, checks: "failure" })).action).toBe("review");
  });

  it("sends a change with no check runs to review", async () => {
    expect((await decide({ ...copyChange, checks: "none" })).action).toBe("review");
  });

  it("sends a change whose tests or preview failed to review", async () => {
    expect((await decide({ ...copyChange, tests: "failed" })).action).toBe("review");
    expect((await decide({ ...copyChange, preview: "failed" })).action).toBe("review");
  });

  it("sends a change to a sensitive file to review", async () => {
    for (const file of [
      "lib/auth/session.ts",
      "db/migrations/0004_users.sql",
      ".github/workflows/ci.yml",
      "package.json",
      "pnpm-lock.yaml",
      ".env.production",
    ]) {
      expect((await decide({ ...copyChange, files: [file] })).action, file).toBe("review");
    }
  });

  it("sends a change with a high finding to review", async () => {
    expect((await decide({ ...copyChange, findings: ["high: the form posts the password in the query string"] })).action).toBe("review");
  });

  it("sends a large change to review", async () => {
    expect((await decide({ ...copyChange, additions: 280, deletions: 40 })).action).not.toBe("merge");
  });

  it("fails closed to review when no provider answers", async () => {
    const broken: DecisionProvider = { name: "broken", ask: async () => Promise.reject(new Error("down")) };
    const outcome = await decide(copyChange, { primary: broken, fallback: broken });
    expect(outcome.action).toBe("review");
    expect(outcome.error).toContain("down");
  });

  it("sends only the declared state fields to the provider", async () => {
    const provider = new FakeProvider();
    await decide({ ...copyChange, token: "secret" }, { primary: provider });
    expect(Object.keys(provider.calls[0]!.state).sort()).toEqual([...def.state].sort());
  });

  it("asks Jev the typed questions and uses its answers", async () => {
    let body: Record<string, any> | undefined;
    const jev = new JevProvider({
      apiKey: "k",
      fetch: (async (_url: string, init: RequestInit) => {
        body = JSON.parse(String(init.body));
        return new Response(
          JSON.stringify({
            answers: {
              safe_to_merge: { type: "noul", noul: 0.4 },
              risk_tier: { type: "choice", probabilities: { low: 0.5, medium: 0.4, high: 0.1 } },
              touches_sensitive_area: { type: "noul", noul: 0.1 },
            },
          }),
        );
      }) as unknown as typeof fetch,
    });
    const outcome = await decide(copyChange, { primary: jev });
    expect(body!.questions.safe_to_merge).toMatchObject({ type: "noul" });
    expect(body!.questions.risk_tier).toMatchObject({ type: "choice" });
    expect(outcome).toMatchObject({ provider: "jev", answers: { safe_to_merge: 0.4 } });
    expect(outcome.action).not.toBe("merge");
  });
});
