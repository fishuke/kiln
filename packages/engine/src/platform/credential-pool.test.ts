import { FakeHarness } from "@kiln/harness";
import { describe, expect, it } from "vitest";
import { createTestKiln } from "../testing";
import { FakeClock } from "../types";

/** Usage each token reports, and tokens the provider rejects. */
type Behaviour = { usage: Record<string, number>; invalid: Set<string>; limited: Set<string> };

function setup() {
  const behaviour: Behaviour = { usage: {}, invalid: new Set(), limited: new Set() };
  const used: string[] = [];
  const harness = new FakeHarness(async (ctx) => {
    const token = ctx.opts.env?.CLAUDE_CODE_OAUTH_TOKEN ?? "";
    used.push(token);
    if (behaviour.invalid.has(token)) throw new Error("Failed to authenticate. API Error: 401 OAuth token has expired");
    const limited = behaviour.limited.has(token);
    ctx.emit({
      type: "rate_limit",
      status: limited ? "rejected" : "allowed",
      fiveHour: { utilization: limited ? 1 : (behaviour.usage[token] ?? 0.1), resetsAt: "2026-10-20T14:00:00.000Z" },
      sevenDay: { utilization: 0.2 },
    });
    if (limited) throw new Error("Claude AI usage limit reached");
    return { summary: "ok" };
  });
  const clock = new FakeClock();
  const { kiln } = createTestKiln({ harness: () => harness, clock });
  kiln.accounts.signup({ email: "olga@acme.test", password: "correct horse battery" });
  const team = kiln.teams.ensureDefaultTeam();
  for (const [name, value] of [
    ["CLAUDE_ALICE", "sk-ant-oat-alice"],
    ["CLAUDE_BOB", "sk-ant-oat-bob"],
  ]) {
    kiln.vault.set({ scope: "team", owner: team.id, name: name!, type: "claude_oauth_token", value }, "olga@acme.test");
  }
  const run = () =>
    kiln.runs.execute({ factory: "webapp", sha: kiln.defs.require("webapp").appliedSha!, agent: "foreman", prompt: "route this", push: false, maxAttempts: 1 });
  return { kiln, team, behaviour, used, run, clock };
}

describe("Claude token pool", () => {
  it("lists every subscription token of a team with its health", () => {
    const { kiln, team } = setup();
    expect(kiln.credentialPool.list(team.id).map((c) => [c.name, c.status])).toEqual([
      ["CLAUDE_ALICE", "unknown"],
      ["CLAUDE_BOB", "unknown"],
    ]);
  });

  it("records each run's usage on the token it used and routes to the one with the most left", async () => {
    const { kiln, team, behaviour, used, run } = setup();
    behaviour.usage["sk-ant-oat-alice"] = 0.9;
    behaviour.usage["sk-ant-oat-bob"] = 0.3;
    const first = await run();
    expect(first.credential).toBe("CLAUDE_ALICE");
    expect(kiln.credentialPool.list(team.id).find((c) => c.name === "CLAUDE_ALICE")).toMatchObject({
      status: "ok",
      fiveHour: { utilization: 0.9 },
      sevenDay: { utilization: 0.2 },
    });
    await run();
    await run();
    expect(used).toEqual(["sk-ant-oat-alice", "sk-ant-oat-bob", "sk-ant-oat-bob"]);
  });

  it("marks a rejected token invalid and stops using it until it works again", async () => {
    const { kiln, team, behaviour, used, run, clock } = setup();
    behaviour.invalid.add("sk-ant-oat-alice");
    const failed = await run();
    expect(failed.status).toBe("failed");
    expect(kiln.credentialPool.list(team.id).find((c) => c.name === "CLAUDE_ALICE")).toMatchObject({
      status: "invalid",
      error: expect.stringContaining("OAuth token has expired"),
    });
    expect((await run()).status).toBe("succeeded");
    expect(used).toEqual(["sk-ant-oat-alice", "sk-ant-oat-bob"]);
    // Replacing the secret's value clears the verdict.
    behaviour.invalid.delete("sk-ant-oat-alice");
    clock.advance(60_000);
    kiln.vault.set({ scope: "team", owner: team.id, name: "CLAUDE_ALICE", type: "claude_oauth_token", value: "sk-ant-oat-alice" }, "olga@acme.test");
    expect(kiln.credentialPool.list(team.id).find((c) => c.name === "CLAUDE_ALICE")!.status).toBe("unknown");
  });

  it("checks a token on demand with one minimal run and records what it reports", async () => {
    const { kiln, team, behaviour, used } = setup();
    behaviour.usage["sk-ant-oat-bob"] = 0.42;
    const entry = await kiln.credentialPool.check({ teamId: team.id }, "CLAUDE_BOB");
    expect(entry).toMatchObject({ name: "CLAUDE_BOB", status: "ok", fiveHour: { utilization: 0.42 } });
    expect(used).toEqual(["sk-ant-oat-bob"]);
    behaviour.invalid.add("sk-ant-oat-alice");
    expect(await kiln.credentialPool.check({ teamId: team.id }, "CLAUDE_ALICE")).toMatchObject({ status: "invalid" });
    await expect(kiln.credentialPool.check({ teamId: team.id }, "NOPE")).rejects.toThrow("no Claude token NOPE");
  });

  it("skips a limited token until its window resets, and says so when nothing is usable", async () => {
    const { kiln, team, behaviour, used, run, clock } = setup();
    behaviour.limited.add("sk-ant-oat-alice");
    await run();
    expect(kiln.credentialPool.list(team.id).find((c) => c.name === "CLAUDE_ALICE")).toMatchObject({ status: "limited", resetsAt: "2026-10-20T14:00:00.000Z" });
    behaviour.invalid.add("sk-ant-oat-bob");
    await run();
    const none = await run();
    expect(none).toMatchObject({ status: "failed", error: { code: "integration_not_configured" } });
    expect(none.error!.message).toMatch(/every Claude token.*CLAUDE_ALICE is limited until/);
    clock.advance(6 * 3_600_000);
    behaviour.limited.delete("sk-ant-oat-alice");
    expect((await run()).status).toBe("succeeded");
    expect(used.at(-1)).toBe("sk-ant-oat-alice");
  });
});
