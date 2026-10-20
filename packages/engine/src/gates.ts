import { BUILTIN_DECISIONS, runDecision } from "@kiln/decide";
import type { Gate as GateDef } from "@kiln/schema";
import type { Kiln } from "./kiln";
import { C, newId, type Gate, type GateKind, type Run, type WorkItem } from "./types";

const UNITS: Record<string, number> = { m: 60_000, h: 3_600_000, d: 86_400_000 };
export function durationMs(s: string): number {
  const m = /^(\d+)(m|h|d)/.exec(s);
  if (!m) throw new Error(`bad duration ${s}`);
  return Number(m[1]) * UNITS[m[2]!]!;
}

export const BUILTIN_GATES: Record<string, GateDef> = {
  "spec-approval": { kind: "approval", approvers: ["requester", "role:po"], evidence: ["spec", "open_questions"], nudge: "24h", expire: "72h -> park" },
  "preview-acceptance": { kind: "preview", approvers: ["requester", "role:po"], evidence: ["preview", "videos"], nudge: "24h", expire: "72h -> park" },
  merge: { kind: "merge", approvers: ["role:code-owners", "requester"], nudge: "48h" },
};

export type Decision = { decision: "approve" | "reject" | "answer"; answer?: string; by: string; via: string };

export class GateService {
  private readonly waiters = new Map<string, ((g: Gate) => void)[]>();

  constructor(private readonly k: Kiln) {}

  get(id: string) {
    return this.k.store.get<Gate>(C.gates, id);
  }

  list(filter: { workItemId?: string; state?: Gate["state"]; factory?: string; assignee?: string } = {}) {
    return this.k.store.list<Gate>(
      C.gates,
      (g) =>
        (!filter.workItemId || g.workItemId === filter.workItemId) &&
        (!filter.state || g.state === filter.state) &&
        (!filter.factory || g.factory === filter.factory) &&
        (!filter.assignee || g.assignees.includes(filter.assignee)),
    );
  }

  resolveAssignees(approvers: string[], wi: WorkItem): string[] {
    const out = new Set<string>();
    for (const a of approvers) {
      if (a === "requester") out.add(wi.requester);
      else if (a.startsWith("role:")) for (const u of this.k.options.roles?.[a.slice(5)] ?? []) out.add(u);
      else out.add(a);
    }
    return [...out];
  }

  async open(input: {
    workItem: WorkItem;
    kind: GateKind;
    name: string;
    title: string;
    question?: string;
    def?: GateDef;
    evidence?: { label: string; url: string }[];
    runId?: string;
    command?: string;
    assignees?: string[];
    questions?: Gate["questions"];
  }): Promise<Gate> {
    const now = this.k.clock.now();
    const def = input.def ?? BUILTIN_GATES[input.name];
    const [expireIn, expireAction] = (def?.expire ?? "").split(" -> ");
    const gate: Gate = {
      id: newId("gate"),
      workItemId: input.workItem.id,
      factory: input.workItem.factory,
      kind: input.kind,
      name: input.name,
      title: input.title,
      question: input.question,
      assignees: input.assignees ?? this.resolveAssignees(def?.approvers ?? ["requester"], input.workItem),
      evidence: input.evidence ?? [],
      state: "open",
      openedAt: now.toISOString(),
      nudges: 0,
      nudgeEveryMs: def?.nudge ? durationMs(def.nudge) : undefined,
      expireAt: expireIn ? new Date(now.getTime() + durationMs(expireIn)).toISOString() : undefined,
      expireAction: (expireAction as Gate["expireAction"]) ?? (expireIn ? "park" : undefined),
      runId: input.runId,
      command: input.command,
      ...(input.questions?.length ? { questions: input.questions } : {}),
    };
    const urgency = await runDecision("inbox-urgency", BUILTIN_DECISIONS["inbox-urgency"]!, { kind: gate.kind, title: gate.title, age_hours: 0 }, this.k.decide).catch(() => undefined);
    gate.urgency = typeof urgency?.answers.urgency === "number" ? urgency.answers.urgency : gate.kind === "question" ? 0.7 : 0.5;
    this.k.store.put(C.gates, gate);
    this.k.bus.publish("gate.opened", { gateId: gate.id, workItemId: gate.workItemId, kind: gate.kind, assignees: gate.assignees });
    const select = gate.questions?.length === 1 && gate.questions[0]!.type === "single_select" ? gate.questions[0] : undefined;
    await this.k.notify(input.workItem, `${gate.title}${gate.question ? `\n${gate.question}` : ""}\nDecide: ${this.k.link(`/inbox/${gate.id}`)}`, { question: select });
    return gate;
  }

  /** Approve, reject or answer from any surface (web, Slack, MCP, CLI): one code path, one result. */
  async decide(id: string, d: Decision): Promise<Gate> {
    const gate = this.get(id);
    if (!gate) throw new Error(`unknown gate ${id}`);
    if (gate.state !== "open") return gate;
    const wi = this.k.workflow.get(gate.workItemId);
    if (d.decision === "answer" && gate.kind !== "question") throw new Error("only question gates take answers");
    const next: Gate = {
      ...gate,
      state: d.decision === "approve" ? "approved" : d.decision === "reject" ? "rejected" : "answered",
      decision: d.decision,
      answer: d.answer,
      decidedBy: d.by,
      decidedVia: d.via,
      decidedAt: this.k.clock.now().toISOString(),
    };
    this.k.store.put(C.gates, next);
    if (wi) this.k.workflow.touch(wi.id, d.by, `${d.decision}d ${gate.title}${d.answer ? `: ${d.answer}` : ""}`);
    this.k.bus.publish("gate.decided", { gateId: id, workItemId: gate.workItemId, decision: d.decision, by: d.by });
    this.k.audit(d.by, `gate.${d.decision}`, id, { via: d.via, answer: d.answer });
    for (const w of this.waiters.get(id) ?? []) w(next);
    this.waiters.delete(id);
    if (!gate.command) void this.k.workflow.onGateDecided(next);
    return next;
  }

  wait(id: string, timeoutMs: number): Promise<Gate | undefined> {
    const g = this.get(id);
    if (g && g.state !== "open") return Promise.resolve(g);
    return new Promise((resolve) => {
      const t = setTimeout(() => resolve(undefined), timeoutMs);
      const list = this.waiters.get(id) ?? [];
      list.push((gate) => {
        clearTimeout(t);
        resolve(gate);
      });
      this.waiters.set(id, list);
    });
  }

  /** The guardrail asked a human about a risky command: an inbox question the run waits on. */
  async askCommand(input: { run: Run; workItem?: WorkItem; command: string }): Promise<boolean> {
    const wi =
      input.workItem ??
      ({ id: `run:${input.run.id}`, factory: input.run.factory, requester: "role:admins", source: { provider: "kiln" } } as unknown as WorkItem);
    const gate = await this.open({
      workItem: wi,
      kind: "question",
      name: "command-approval",
      title: `Allow ${input.run.agent} to run a risky command?`,
      question: `\`${input.command}\`\nApprove to run it, reject to block it.`,
      runId: input.run.id,
      command: input.command,
      assignees: input.workItem ? this.resolveAssignees(["requester", "role:admins"], input.workItem) : this.k.options.roles?.admins ?? [],
    });
    const decided = await this.wait(gate.id, this.k.options.askHumanTimeoutMs ?? 30 * 60_000);
    if (!decided) this.k.store.put(C.gates, { ...gate, state: "expired", decidedBy: "kiln:timeout", decidedAt: this.k.clock.now().toISOString() });
    return decided?.state === "approved";
  }

  /** Nudge reminders and expiry, driven by the clock. */
  async tick() {
    const now = this.k.clock.now();
    for (const g of this.list({ state: "open" })) {
      const wi = this.k.workflow.get(g.workItemId);
      if (g.expireAt && new Date(g.expireAt) <= now) {
        if (g.expireAction === "approve" || g.expireAction === "reject") {
          await this.decide(g.id, { decision: g.expireAction, by: "kiln:expiry", via: "timer" });
        } else {
          this.k.store.put(C.gates, { ...g, state: "expired", decidedAt: now.toISOString(), decidedBy: "kiln:expiry" });
          if (wi) this.k.workflow.park(wi.id, `${g.title} expired without a decision`);
        }
        continue;
      }
      const last = new Date(g.lastNudgeAt ?? g.openedAt).getTime();
      if (g.nudgeEveryMs && now.getTime() - last >= g.nudgeEveryMs) {
        this.k.store.put(C.gates, { ...g, nudges: g.nudges + 1, lastNudgeAt: now.toISOString() });
        this.k.bus.publish("gate.nudged", { gateId: g.id, workItemId: g.workItemId });
        if (wi) await this.k.notify(wi, `Reminder: ${g.title} is waiting on ${g.assignees.join(", ") || "you"}. ${this.k.link(`/inbox/${g.id}`)}`);
      }
    }
  }

  /** Open gates ordered for a person: most urgent first, then oldest. */
  inbox(assignee?: string): Gate[] {
    return this.list({ state: "open" })
      .filter((g) => !assignee || g.assignees.includes(assignee) || g.assignees.length === 0)
      .sort((a, b) => (b.urgency ?? 0) - (a.urgency ?? 0) || a.openedAt.localeCompare(b.openedAt));
  }
}
