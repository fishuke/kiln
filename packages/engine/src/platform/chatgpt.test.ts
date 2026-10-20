import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventStream, FakeHarness } from "@kiln/harness";
import { LocalSandboxProvider, NodeCommandRunner, type CommandRunner, type Proc } from "@kiln/sandbox";
import { describe, expect, it } from "vitest";
import { createTestKiln } from "../testing";
import { FakeClock } from "../types";
import { canonicalChatgptAuth, chatgptRefreshDue, isChatgptRefresh, parseChatgptAuth, parseDeviceAuth, redactChatgptTokens } from "./chatgpt";

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
const idToken = (email: string, account: string) =>
  `h.${b64({ email, "https://api.openai.com/auth": { chatgpt_plan_type: "pro", chatgpt_account_id: account } })}.sig`;
const authJson = (refresh: string, lastRefresh: string, email = "olga@acme.test", account = "acct_1") =>
  JSON.stringify({
    OPENAI_API_KEY: null,
    tokens: { id_token: idToken(email, account), access_token: `access-${refresh}`, refresh_token: refresh, account_id: account },
    last_refresh: lastRefresh,
  });
/** Codex homes left in /tmp for an id (a run or a sign-in). */
const homesOf = (id: string) => readdirSync("/tmp").filter((d) => d.startsWith(`kiln-codex-${id}-`));
const admin = { admin: true };

describe("ChatGPT logins", () => {
  it("reads Codex's auth.json and knows when Codex will refresh it", () => {
    const auth = parseChatgptAuth(authJson("rt-1", "2026-10-20T10:00:00.000Z"))!;
    expect(auth).toMatchObject({ email: "olga@acme.test", plan: "pro", accountId: "acct_1", lastRefresh: "2026-10-20T10:00:00.000Z", refreshToken: "rt-1" });
    expect(parseChatgptAuth(JSON.stringify({ OPENAI_API_KEY: "sk-1" }))).toBeUndefined();
    expect(parseChatgptAuth("not json")).toBeUndefined();
    expect(chatgptRefreshDue(auth, new Date("2026-10-21T10:00:00.000Z"))).toBe(false);
    expect(chatgptRefreshDue(auth, new Date("2026-10-28T10:00:00.000Z"))).toBe(true);
  });

  it("keeps only the fields Codex reads, and accepts a refresh only of the same account", () => {
    const stored = authJson("rt-1", "2026-10-20T10:00:00.000Z");
    expect(JSON.parse(canonicalChatgptAuth(JSON.stringify({ ...JSON.parse(stored), extra: "x".repeat(100) }))!)).not.toHaveProperty("extra");
    const now = new Date("2026-10-20T12:00:00.000Z");
    expect(isChatgptRefresh(stored, authJson("rt-2", "2026-10-20T11:00:00.000Z"), now)).toBe(true);
    expect(isChatgptRefresh(stored, authJson("rt-2", "2026-10-20T11:00:00.000Z", "eve@evil.test", "acct_eve"), now)).toBe(false);
    expect(isChatgptRefresh(stored, authJson("rt-1", "2026-10-20T11:00:00.000Z"), now)).toBe(false);
    expect(isChatgptRefresh(stored, authJson("rt-2", "2026-10-20T09:00:00.000Z"), now)).toBe(false);
    expect(isChatgptRefresh(stored, authJson("rt-2", "2027-01-01T00:00:00.000Z"), now)).toBe(false);
  });

  it("redacts tokens a refresh produced mid-run", () => {
    const text = `cat auth.json → ${authJson("rt-secret-9", "2026-10-20T11:00:00.000Z")}`;
    expect(redactChatgptTokens(text)).not.toMatch(/rt-secret-9|access-rt-secret-9|h\.eyJ/);
  });

  it("reads the link and code from codex login --device-auth", () => {
    const out =
      "Follow these steps to sign in with ChatGPT using device code authorization:\n\n1. Open this link in your browser and sign in to your account\n   \u001b[94mhttps://auth.openai.com/codex/device\u001b[0m\n\n2. Enter this one-time code \u001b[90m(expires in 15 minutes)\u001b[0m\n   \u001b[94mABCD-12345\u001b[0m\n";
    expect(parseDeviceAuth(out)).toEqual({ verificationUrl: "https://auth.openai.com/codex/device", userCode: "ABCD-12345" });
    expect(parseDeviceAuth("Welcome to Codex")).toBeUndefined();
  });
});

function setup(lastRefresh = "2026-10-20T10:00:00.000Z") {
  const seen: { home?: string; auth?: string }[] = [];
  let release: (() => void) | undefined;
  const behaviour = { refreshTo: undefined as string | undefined, writeAuth: undefined as string | undefined, usageLimit: false, hold: false };
  const harness = new FakeHarness(async (ctx) => {
    const home = ctx.opts.env?.CODEX_HOME;
    const auth = home ? await ctx.opts.sandbox.readFile(`${home}/auth.json`) : undefined;
    seen.push({ home, auth });
    if (behaviour.hold) await new Promise<void>((r) => (release = r));
    // Codex refreshed the login during the run and rewrote auth.json.
    if (home && behaviour.refreshTo) await ctx.opts.sandbox.writeFile(`${home}/auth.json`, authJson(behaviour.refreshTo, "2026-10-20T12:00:00.000Z"));
    // The agent (or instructions injected into it) replacing the login with another account.
    if (home && behaviour.writeAuth) await ctx.opts.sandbox.writeFile(`${home}/auth.json`, behaviour.writeAuth);
    if (behaviour.usageLimit) {
      ctx.emit({ type: "rate_limit", status: "rejected", fiveHour: { utilization: 1, resetsAt: "2026-10-20T15:00:00.000Z" } });
      throw new Error("You've hit your usage limit. Try again in 3 hours.");
    }
    return { summary: "ok" };
  });
  const clock = new FakeClock(new Date("2026-10-20T12:00:00.000Z"));
  const { kiln } = createTestKiln({ harness: () => harness, clock });
  kiln.accounts.signup({ email: "olga@acme.test", password: "correct horse battery" });
  const team = kiln.teams.ensureDefaultTeam();
  kiln.vault.set({ scope: "team", owner: team.id, name: "CHATGPT_OLGA", type: "chatgpt_auth", value: authJson("rt-1", lastRefresh) }, "olga@acme.test");
  const run = () =>
    kiln.runs.execute({
      factory: "webapp",
      sha: kiln.defs.require("webapp").appliedSha!,
      agent: "foreman",
      prompt: "route this",
      push: false,
      maxAttempts: 1,
      overrides: { harness: "codex" },
    });
  const stored = () => kiln.vault.typedValue("team", team.id, "CHATGPT_OLGA", "chatgpt_auth") as string;
  return { kiln, team, run, seen, behaviour, clock, stored, release: () => release?.() };
}

describe("Codex runs with a ChatGPT login", () => {
  it("gets the login as Codex's auth.json outside the workspace, and keeps the refreshed one", async () => {
    const { kiln, team, run, seen, behaviour, stored } = setup();
    behaviour.refreshTo = "rt-2";
    const done = await run();
    expect(done.status).toBe("succeeded");
    expect(done.credential).toBe("CHATGPT_OLGA");
    expect(seen[0]!.home).toMatch(new RegExp(`^/tmp/kiln-codex-${done.id}-[0-9a-f]{12}$`));
    expect(parseChatgptAuth(seen[0]!.auth!)?.refreshToken).toBe("rt-1");
    // The refreshed login replaced the stored one; its health carried over, and nothing is left on disk.
    expect(parseChatgptAuth(stored())?.refreshToken).toBe("rt-2");
    expect(kiln.credentialPool.list(team.id, undefined, "chatgpt")).toEqual([expect.objectContaining({ name: "CHATGPT_OLGA", status: "ok" })]);
    expect(homesOf(done.id)).toEqual([]);
    expect(kiln.store.list<{ id: string; action: string; actor: string }>("audit", (e) => e.action === "chatgpt.refreshed").map((e) => e.actor)).toEqual([
      `run:${done.id}`,
    ]);
  });

  it("never keeps an auth.json the agent wrote for another account", async () => {
    const { run, behaviour, stored } = setup();
    const before = stored();
    behaviour.writeAuth = authJson("rt-evil", "2026-10-20T11:59:00.000Z", "eve@evil.test", "acct_eve");
    expect((await run()).status).toBe("succeeded");
    expect(stored()).toBe(before);
  });

  it("marks a login limited when its plan's usage runs out", async () => {
    const { kiln, team, run, behaviour } = setup();
    behaviour.usageLimit = true;
    expect((await run()).status).not.toBe("succeeded");
    expect(kiln.credentialPool.list(team.id, undefined, "chatgpt")[0]).toMatchObject({ status: "limited", resetsAt: "2026-10-20T15:00:00.000Z" });
    await expect(run()).resolves.toMatchObject({
      status: "failed",
      error: expect.objectContaining({ message: expect.stringContaining("every ChatGPT login is unusable") }),
    });
  });

  it("shares a fresh login between runs, but not one Codex is about to refresh", async () => {
    const fresh = setup();
    fresh.behaviour.hold = true;
    const a = fresh.run();
    await waitUntil(() => fresh.seen.length === 1);
    fresh.behaviour.hold = false;
    const b = await fresh.run();
    expect(b.credential).toBe("CHATGPT_OLGA");
    fresh.release();
    await a;

    const due = setup("2026-10-01T00:00:00.000Z");
    due.behaviour.hold = true;
    const first = due.run();
    await waitUntil(() => due.seen.length === 1);
    due.behaviour.hold = false;
    const second = await due.run();
    expect(second.error).toMatchObject({ code: "resource_unavailable", message: expect.stringContaining("being refreshed") });
    due.release();
    expect((await first).status).toBe("succeeded");
    // Released when the first run ended.
    expect((await due.run()).status).toBe("succeeded");
  });

  it("reads a login by its exact owner: a personal secret of the same name changes nothing, a personal login shadows it", async () => {
    const { kiln, team, run, seen } = setup();
    kiln.vault.set({ scope: "personal", owner: "usr_ted", name: "CHATGPT_OLGA", type: "raw", value: "not a login" }, "ted@acme.test");
    expect(kiln.credentialPool.list(team.id, "usr_ted", "chatgpt").map((l) => l.scope)).toEqual(["team"]);
    await run();
    expect(parseChatgptAuth(seen[0]!.auth!)?.refreshToken).toBe("rt-1");
    kiln.vault.set({ scope: "personal", owner: "usr_amy", name: "CHATGPT_OLGA", type: "chatgpt_auth", value: authJson("rt-amy", "2026-10-20T10:00:00.000Z") }, "amy@acme.test");
    expect(kiln.credentialPool.list(team.id, "usr_amy", "chatgpt").map((l) => l.scope)).toEqual(["personal"]);
  });
});

/** A `codex` binary that prints the device code, then (once "approved") writes auth.json and exits. */
function fakeCodexRunner(approve: Promise<void>): CommandRunner {
  const node = new NodeCommandRunner();
  return {
    run: (cmd, args, opts) => node.run(cmd, args, opts),
    spawn: (cmd, args, opts): Proc => {
      if (cmd !== "codex") return node.spawn(cmd, args, opts);
      const lines = new EventStream<string>();
      let killed = false;
      const exit = (async () => {
        for (const l of [
          "Follow these steps to sign in with ChatGPT:",
          "   https://auth.openai.com/codex/device",
          "2. Enter this one-time code (expires in 15 minutes)",
          "   WXYZ-98765",
        ])
          lines.push(l);
        await approve;
        if (killed) return { code: 1, stdout: "", stderr: "killed" };
        const home = opts!.env!.CODEX_HOME!;
        mkdirSync(home, { recursive: true });
        writeFileSync(join(home, "auth.json"), authJson("rt-signed-in", "2026-10-20T12:00:00.000Z", "ted@acme.test"));
        lines.close();
        return { code: 0, stdout: "", stderr: "" };
      })();
      return { lines, write: () => {}, closeStdin: () => {}, kill: () => (killed = true), exit };
    },
  };
}

describe("Sign in with ChatGPT", () => {
  it("shows the device code, then stores the login once the person approves it", async () => {
    let approve!: () => void;
    const approved = new Promise<void>((r) => (approve = r));
    const { kiln } = createTestKiln({ sandboxes: { local: new LocalSandboxProvider(join(tmpdir(), "kiln-sandboxes"), fakeCodexRunner(approved)) } });
    const team = kiln.teams.ensureDefaultTeam();
    const started = await kiln.chatgptSignIn.start({ teamId: team.id, scope: "team", owner: team.id, name: "CHATGPT_TED", by: "ted@acme.test" });
    expect(started).toMatchObject({ status: "pending", verificationUrl: "https://auth.openai.com/codex/device", userCode: "WXYZ-98765" });
    expect(kiln.vault.resolver({ teamId: team.id }).get("CHATGPT_TED")).toBeUndefined();

    approve();
    await waitUntil(() => kiln.chatgptSignIn.get(team.id, started.id, admin).status !== "pending");
    expect(kiln.chatgptSignIn.get(team.id, started.id, admin)).toMatchObject({ status: "succeeded", email: "ted@acme.test", plan: "pro" });
    expect(kiln.credentialPool.list(team.id, undefined, "chatgpt").map((c) => c.name)).toEqual(["CHATGPT_TED"]);
    expect(homesOf(started.id)).toEqual([]);
    expect(() => kiln.chatgptSignIn.get("another-team", started.id, admin)).toThrow(/no ChatGPT sign-in/);
  });

  it("is only for whoever started it (or an admin), and can be cancelled while it waits", async () => {
    const { kiln } = createTestKiln({
      sandboxes: { local: new LocalSandboxProvider(join(tmpdir(), "kiln-sandboxes"), fakeCodexRunner(new Promise(() => {}))) },
    });
    const team = kiln.teams.ensureDefaultTeam();
    const started = await kiln.chatgptSignIn.start({ teamId: team.id, scope: "team", owner: team.id, name: "CHATGPT_X", by: "a", userId: "usr_ted" });
    // Whoever enters the code picks the account, so another member cannot see it.
    expect(() => kiln.chatgptSignIn.get(team.id, started.id, { userId: "usr_other", admin: false })).toThrow(/no ChatGPT sign-in/);
    expect((await kiln.chatgptSignIn.cancel(team.id, started.id, { userId: "usr_ted", admin: false })).status).toBe("cancelled");
    expect(homesOf(started.id)).toEqual([]);
  });

  it("refuses a name that is already another kind of secret", async () => {
    const { kiln } = createTestKiln();
    const team = kiln.teams.ensureDefaultTeam();
    kiln.vault.set({ scope: "team", owner: team.id, name: "TAKEN", type: "raw", value: "x" }, "a");
    await expect(kiln.chatgptSignIn.start({ teamId: team.id, scope: "team", owner: team.id, name: "TAKEN", by: "a" })).rejects.toMatchObject({
      code: "conflict",
    });
  });
});

async function waitUntil(cond: () => boolean, ms = 5000) {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
}
