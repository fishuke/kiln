import { issueToken } from "@kiln/auth";
import { createTestKiln, sampleTree } from "@kiln/engine";
import { KilnClient } from "@kiln/sdk-ts";
import { describe, expect, it } from "vitest";
import { createApp } from "./app";

const pw = "correct horse battery";

/** Two teams: Default (owner olga, factory webapp) and Payments (owner pete, factory pay). */
async function twoTeams(serverAdmins: string[] = []) {
  const t = createTestKiln({ preview: false, serverAdmins });
  const app = createApp(t.kiln);
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => app.fetch(new Request(input as string, init))) as typeof fetch;
  const client = (token?: string) => new KilnClient({ baseUrl: "http://kiln.test", token, fetch: fetchImpl });
  const olga = await client().signup({ email: "olga@acme.test", password: pw });
  const o = client(olga.token);
  const inv = await o.inviteMember("default", "pete@acme.test", "member");
  const pete = await client().signup({ email: "pete@acme.test", password: pw, invite: inv.token });
  const p = client(pete.token);
  await p.createTeam({ name: "Payments" });
  const pay = p.withTeam("payments");
  await pay.apply(sampleTree({}, "Pay", "pay", "acme/web"));
  await pay.createManagedSecret({ name: "PAY_TOKEN", value: "pay-secret-value" });
  await pay.inviteMember("payments", "someone@acme.test");
  const bootstrap = issueToken(t.kiln.store, { name: "bootstrap", subject: "admin@kiln.local", grants: [{ scope: "admin", factory: "*" }] }).token;
  return { ...t, client, o, p, pay, olga, pete, admin: client(bootstrap) };
}

describe("multi-team isolation: planning, skills and decisions", () => {
  it("projects and the portfolio are per team", async () => {
    const { o, pay, admin } = await twoTeams();
    const mine = await o.createProject({ name: "Portal", factories: ["webapp"] });
    const theirs = await pay.createProject({ name: "Payouts", factories: ["pay"] });
    expect((await o.projects()).map((p) => p.name)).toEqual(["Portal"]);
    expect((await pay.projects()).map((p) => p.name)).toEqual(["Payouts"]);
    await expect(o.project(theirs.id)).rejects.toMatchObject({ status: 404 });
    await expect(o.plan(theirs.id, { goal: "x" })).rejects.toMatchObject({ status: 404 });
    expect((await o.project(mine.id)).name).toBe("Portal");
    const portfolio = await o.portfolio();
    expect(portfolio.totals.factories).toBe(1);
    expect(portfolio.projects.map((p) => p.project.name)).toEqual(["Portal"]);
    expect((await admin.portfolio()).totals.factories).toBe(2);
    await expect(admin.createProject({ name: "Both", factories: ["webapp", "pay"] })).rejects.toMatchObject({ status: 400, message: "a project's factories must belong to one team" });
  });

  it("the skills catalog is per team, and skills install only within a team", async () => {
    const { o, pay, admin } = await twoTeams();
    const listing = await pay.publishSkill("pay", "house-style");
    expect((await pay.skills()).listings.map((l) => l.id)).toEqual([listing.id]);
    const ours = await o.skills();
    expect(ours.listings).toEqual([]);
    expect(ours.catalog.flatMap((r) => r.factories)).toEqual(["webapp"]);
    await expect(o.installSkill(listing.id, "webapp")).rejects.toMatchObject({ status: 404 });
    expect((await admin.skills()).listings).toHaveLength(1);
  });

  it("decision logs follow the factories you can see", async () => {
    const { o, pay, kiln } = await twoTeams();
    const wi = await pay.send({ factory: "pay", title: "Fix typo" });
    for (let i = 0; i < 100 && !kiln.store.list<{ id: string; workItemId?: string }>("decision_logs").some((d) => d.workItemId === wi.id); i++) await new Promise((r) => setTimeout(r, 30));
    expect((await pay.decisions(wi.id)).length).toBeGreaterThan(0);
    expect(await o.decisions(wi.id)).toEqual([]);
    expect((await o.decisions()).some((d) => d.workItemId === wi.id)).toBe(false);
  });
});

describe("multi-team isolation", () => {
  it("team admins see only their own team's audit log", async () => {
    const { o, pay, admin } = await twoTeams();
    const mine = await o.audit();
    expect(mine.length).toBeGreaterThan(0);
    expect(JSON.stringify(mine)).not.toMatch(/PAY_TOKEN|payments|"pay"/);
    const theirs = await pay.audit();
    expect(theirs.map((a) => a.action)).toEqual(expect.arrayContaining(["team.created", "secret.created", "team.invite_created", "definition.applied"]));
    expect(theirs.some((a) => a.action === "team.invite_created" && JSON.stringify(a.details).includes("pete@acme.test"))).toBe(false);
    const all = await admin.audit(1000);
    expect(all.length).toBeGreaterThan(mine.length + theirs.length - 1);
  });

  it("team admins list only their team's tokens and cannot issue tokens outside it", async () => {
    const { o, pay, admin, kiln } = await twoTeams();
    const key = await pay.createApiKey({ name: "pay-bot", type: "agent" });
    const listed = await o.tokens();
    expect(listed.some((t) => t.id === key.record.id)).toBe(false);
    expect(listed.some((t) => t.name === "bootstrap")).toBe(false);
    expect((await pay.tokens()).some((t) => t.id === key.record.id)).toBe(true);
    expect((await admin.tokens()).length).toBe(kiln.store.list("api_tokens").length);
    await expect(o.issueToken({ name: "x", subject: "ci", grants: [{ scope: "admin", factory: "*" }] })).rejects.toMatchObject({ status: 403 });
    await expect(o.issueToken({ name: "x", subject: "ci", grants: [{ scope: "read", factory: "pay" }] })).rejects.toMatchObject({ status: 403 });
    const ok = await o.issueToken({ name: "ci", subject: "ci@acme.test", grants: [{ scope: "read", factory: "webapp" }] });
    expect(kiln.store.get<{ id: string; teamId?: string }>("api_tokens", ok.record.id)?.teamId).toBe(kiln.teams.get("default")!.id);
  });

  it("server secrets are per team for team admins; only server admins touch the server store", async () => {
    const { o, pay, admin, kiln } = await twoTeams();
    expect(await o.secrets()).toEqual([]);
    expect(await pay.secrets()).toEqual(["PAY_TOKEN"]);
    await o.setSecret("NPM_TOKEN", "npm-default");
    expect(kiln.secrets.getSecret("NPM_TOKEN")).toBeUndefined();
    expect(kiln.vault.resolver({ teamId: kiln.teams.get("default")!.id }).get("NPM_TOKEN")).toBe("npm-default");
    await admin.setSecret("GITHUB_WEBHOOK_SECRET", "hook");
    expect(kiln.secrets.getSecret("GITHUB_WEBHOOK_SECRET")).toBe("hook");
    expect(await admin.secrets()).toContain("GITHUB_WEBHOOK_SECRET");
    expect(await o.secrets()).toEqual(["NPM_TOKEN"]);
  });

  it("users in KILN_ADMIN_EMAILS are server admins", async () => {
    const { o, pay } = await twoTeams(["olga@acme.test"]);
    const all = await o.audit(1000);
    expect(all.some((a) => a.action === "secret.created" && a.target.includes("PAY_TOKEN"))).toBe(true);
    expect((await pay.audit(1000)).length).toBeLessThan(all.length);
  });
});
