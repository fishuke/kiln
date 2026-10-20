import { FakeChat, FakeMailer } from "@kiln/integrations";
import { describe, expect, it } from "vitest";
import { createTestKiln, waitFor } from "../testing";
import { FakeClock } from "../types";

const pw = "correct horse battery";
const until = async (check: () => boolean, ms = 5000) => {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 20));
  }
};

function setup(clock?: FakeClock) {
  const mailer = new FakeMailer();
  const slack = new FakeChat();
  const discord = new FakeChat();
  const t = createTestKiln({ mailer, chats: { slack, discord }, clock });
  const po = t.kiln.accounts.signup({ email: "po@acme.test", password: pw }).user;
  return { ...t, mailer, slack, discord, po };
}

describe("notifications", () => {
  it("emails and DMs a spec approval to its assignee, per their preferences", async () => {
    const { kiln, mailer, slack, discord, po } = setup();
    kiln.users.link(po.id, "slack", "U_PO");
    kiln.users.update(po.id, { notifications: { spec: { email: true, slack: true, discord: true } } });
    const wi = await kiln.workflow.create({ factory: "webapp", title: "Saved carts", body: "- Save a cart\n- Restore it\n- List saved carts", source: { provider: "api" }, requester: "po@acme.test" });
    void kiln.workflow.advance(wi.id);
    await waitFor(kiln, wi.id, ["awaiting_spec"]);
    await until(() => mailer.sent.length > 0 && slack.dms.length > 0);
    expect(mailer.sent[0]).toMatchObject({ to: "po@acme.test", subject: expect.stringMatching(/^Spec to approve: /) });
    expect(mailer.sent[0]!.text).toMatch(/Decide: http:\/\/localhost:3000\/inbox\/gate_/);
    expect(slack.dms[0]).toMatchObject({ user: "U_PO", text: expect.stringContaining("Spec to approve") });
    // no Discord account linked, so no Discord message
    expect(discord.messages).toEqual([]);
    expect(kiln.notifications.history(po.id).map((n) => `${n.kind}:${n.channel}:${n.status}`)).toEqual(expect.arrayContaining(["spec:email:sent", "spec:slack:sent"]));
  });

  it("respects a channel that is turned off, and tells the requester when work is blocked", async () => {
    const { kiln, mailer, po } = setup();
    kiln.users.update(po.id, { notifications: { spec: { email: false, slack: false, discord: false } } });
    const team = kiln.teams.ensureDefaultTeam();
    kiln.teams.updateSettings(team.id, { spendLimit: { monthlyUsd: 0, autoStop: true } }, "a");
    const wi = await kiln.workflow.create({ factory: "webapp", title: "Fix typo", body: "", source: { provider: "api" }, requester: "po@acme.test" });
    await kiln.workflow.advance(wi.id);
    expect(kiln.workflow.get(wi.id)!.state).toBe("blocked");
    await until(() => mailer.sent.length > 0);
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]).toMatchObject({ subject: "Work is blocked: Fix typo", text: expect.stringContaining("Monthly spending budget of $0 has been reached") });
  });

  it("sends a daily digest instead, once a day, at the chosen hour", async () => {
    const clock = new FakeClock(new Date("2026-10-20T08:00:00Z"));
    const { kiln, mailer, po } = setup(clock);
    kiln.users.update(po.id, { digest: { daily: true, hourUtc: 9, only: true } });
    const wi = await kiln.workflow.create({ factory: "webapp", title: "Saved carts", body: "- Save a cart\n- Restore it\n- List saved carts", source: { provider: "api" }, requester: "po@acme.test" });
    void kiln.workflow.advance(wi.id);
    await waitFor(kiln, wi.id, ["awaiting_spec"]);
    await new Promise((r) => setTimeout(r, 100));
    expect(mailer.sent).toEqual([]);
    await kiln.notifications.tick();
    expect(mailer.sent).toEqual([]);
    clock.advance(3_600_000);
    await kiln.notifications.tick();
    await kiln.notifications.tick();
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]).toMatchObject({ to: "po@acme.test", subject: "Kiln: 1 decision(s) waiting on you" });
    clock.advance(24 * 3_600_000);
    await kiln.notifications.tick();
    expect(mailer.sent).toHaveLength(2);
  });

  it("a failing channel is recorded and audited, not thrown", async () => {
    const { kiln, po } = setup();
    const broken = { name: "smtp", send: async () => Promise.reject(new Error("connection refused")) };
    Object.assign(kiln.options, { mailer: broken });
    const gate = { id: "gate_x", workItemId: "wi_x", factory: "webapp", kind: "question", name: "q", title: "Which colour?", assignees: ["po@acme.test"], evidence: [], state: "open", openedAt: "", nudges: 0 } as never;
    await kiln.notifications.onGate(gate);
    expect(kiln.notifications.history(po.id)[0]).toMatchObject({ channel: "email", status: "failed", error: "connection refused" });
    expect(kiln.auditLog().some((a) => a.action === "notify.failed")).toBe(true);
  });
});
