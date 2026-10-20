import type { Kiln } from "./kiln";
import { page, taskStage } from "./run-state";
import { C, type GateQuestion, type InboxState, type Run, type TaskStage } from "./types";

export const INBOX_KINDS = ["question", "answer_question", "spec_review", "pr_review", "blocked", "failed"] as const;
export type InboxKind = (typeof INBOX_KINDS)[number];

export type InboxItem = {
  id: string;
  kind: InboxKind;
  factory: string;
  taskId?: string;
  title: string;
  description?: string;
  stage?: TaskStage;
  questions?: GateQuestion[];
  originLink?: string;
  url: string;
  urls: string[];
  artifacts: { url: string; title: string }[];
  runId?: string;
  gateId?: string;
  changeId?: string;
  proposalId?: string;
  diff?: { added: string[]; changed: string[]; removed: string[] };
  patches?: { path: string; before?: string; after?: string }[];
  /** What the person can do from the inbox. */
  actions: string[];
  recipients: string[];
  urgency: number;
  createdAt: string;
  isRead?: boolean;
  resolvedAt?: string;
};

export type InboxFilter = { user: string; scope?: "mine" | "team"; factory?: string; kind?: InboxKind[]; read?: boolean; q?: string; includeResolved?: boolean; limit?: number; cursor?: string; visible?: (factory: string) => boolean };

const RECENT_MS = 7 * 86_400_000;

/**
 * The personal inbox across factories: questions, spec and PR reviews, blocked and failed work,
 * and definition changes to review. Items are derived from live state, so they clear themselves
 * when they stop being relevant (the question was answered, the PR merged); read and resolved
 * flags are kept per person.
 */
export class InboxService {
  constructor(private readonly k: Kiln) {}

  private admins(): string[] {
    return this.k.options.roles?.admins ?? [];
  }

  /** Every current item, before per-person filtering. */
  all(): InboxItem[] {
    const now = this.k.clock.now().getTime();
    const items: InboxItem[] = [];
    const gates = this.k.gates.list();
    const openByTask = new Set(gates.filter((g) => g.state === "open").map((g) => g.workItemId));
    for (const g of gates) {
      const wi = this.k.workflow.get(g.workItemId);
      if (wi?.deletedAt) continue;
      const common = {
        factory: g.factory,
        ...(wi ? { taskId: wi.id, stage: taskStage(wi), originLink: wi.source.url } : {}),
        url: this.k.link(`/inbox/${g.id}`),
        urls: g.evidence.map((e) => e.url),
        artifacts: g.evidence.map((e) => ({ url: e.url, title: e.label })),
        runId: g.runId,
        gateId: g.id,
      };
      if (g.state === "open") {
        const kind: InboxKind = g.kind === "spec" ? "spec_review" : g.kind === "preview" || g.kind === "merge" ? "pr_review" : "question";
        items.push({
          ...common,
          id: `gate:${g.id}`,
          kind,
          title: g.title,
          description: g.question,
          ...(g.questions?.length ? { questions: g.questions } : {}),
          actions: kind === "question" ? ["answer", "reject"] : kind === "spec_review" ? ["approve", "request_changes"] : ["approve", "reject"],
          recipients: g.assignees.length ? g.assignees : wi ? [wi.requester] : this.admins(),
          urgency: g.urgency ?? 0.5,
          createdAt: g.openedAt,
        });
      } else if (g.kind === "question" && g.state === "answered" && g.decidedAt && now - new Date(g.decidedAt).getTime() < RECENT_MS && wi) {
        items.push({ ...common, id: `answer:${g.id}`, kind: "answer_question", title: `Answered: ${g.title}`, description: g.answer, actions: ["view"], recipients: [wi.requester], urgency: 0.1, createdAt: g.decidedAt });
      }
    }
    // Blocked and failed tasks only when nothing else on the task needs the person.
    for (const wi of this.k.workflow.list()) {
      if (wi.deletedAt || openByTask.has(wi.id)) continue;
      const kind: InboxKind | undefined = wi.state === "blocked" ? "blocked" : wi.state === "failed" ? "failed" : undefined;
      if (!kind) continue;
      items.push({
        id: `task:${wi.id}:${kind}`,
        kind,
        factory: wi.factory,
        taskId: wi.id,
        stage: taskStage(wi),
        title: `${kind === "blocked" ? "Blocked" : "Failed"}: ${wi.title}`,
        description: wi.blockedReason,
        originLink: wi.source.url,
        url: this.k.link(`/runs/${wi.id}`),
        urls: wi.pr ? [wi.pr.url] : [],
        artifacts: [],
        actions: kind === "blocked" ? ["message", "cancel"] : ["view"],
        recipients: [wi.requester],
        urgency: kind === "blocked" ? 0.6 : 0.4,
        createdAt: wi.updatedAt,
      });
    }
    for (const r of this.k.store.list<Run>(C.runs, (r) => !r.workItemId && !r.parentRunId && r.kind === "work" && (r.status === "failed" || r.status === "error"))) {
      if (!r.finishedAt || now - new Date(r.finishedAt).getTime() > RECENT_MS || !r.creator || r.creator.includes(":")) continue;
      items.push({ id: `run:${r.id}:failed`, kind: "failed", factory: r.factory, title: `Failed: ${r.title ?? r.agent}`, description: r.error?.message ?? r.summary, url: this.k.link(`/agent-runs/${r.id}`), urls: [], artifacts: r.artifacts.map((a) => ({ url: a.url, title: a.name })), runId: r.id, actions: ["view", "followup"], recipients: [r.creator], urgency: 0.4, createdAt: r.finishedAt });
    }
    for (const c of this.k.definitionChanges.list({ state: "open" })) {
      const wi = c.workItemId ? this.k.workflow.get(c.workItemId) : undefined;
      items.push({
        id: `defchange:${c.id}`,
        kind: "spec_review",
        factory: c.factory,
        ...(wi ? { taskId: wi.id } : {}),
        title: `Definition change: ${c.title}`,
        description: c.message,
        url: this.k.link(`/f/${c.factory}/definition/changes/${c.id}`),
        urls: [],
        artifacts: [],
        runId: c.runId,
        changeId: c.id,
        diff: c.diff,
        patches: c.patches,
        actions: ["approve_and_merge", "request_changes", "comment"],
        recipients: [...new Set([...(wi ? [wi.requester] : []), ...this.admins()])],
        urgency: 0.5,
        createdAt: c.createdAt,
      });
    }
    for (const p of this.k.improvement.list().filter((p) => p.state === "open")) {
      items.push({
        id: `proposal:${p.id}`,
        kind: "spec_review",
        factory: p.factory,
        title: `Self-improvement: ${p.agent} (${p.category})`,
        description: p.rationale,
        url: p.pr?.url ?? this.k.link(`/f/${p.factory}/self-improvement/${p.id}`),
        urls: p.pr ? [p.pr.url] : [],
        artifacts: [],
        proposalId: p.id,
        patches: Object.entries(p.changes).map(([path, after]) => ({ path, after })),
        actions: ["approve_and_merge", "reject"],
        recipients: p.reviewer ? [p.reviewer] : this.admins(),
        urgency: 0.3,
        createdAt: p.createdAt,
      });
    }
    return items;
  }

  private stateFor(user: string): Map<string, InboxState> {
    return new Map(this.k.store.list<InboxState>(C.inboxState, (s) => s.user === user).map((s) => [s.itemId, s]));
  }

  list(filter: InboxFilter) {
    const states = this.stateFor(filter.user);
    const q = filter.q?.toLowerCase();
    const mine = (filter.scope ?? "mine") === "mine";
    const rows = this.all()
      .filter((i) => !filter.visible || filter.visible(i.factory))
      .filter((i) => !mine || i.recipients.includes(filter.user))
      .filter((i) => !filter.factory || i.factory === filter.factory)
      .filter((i) => !filter.kind?.length || filter.kind.includes(i.kind))
      .filter((i) => !q || i.title.toLowerCase().includes(q) || (i.description ?? "").toLowerCase().includes(q))
      .map((i) => {
        const s = states.get(i.id);
        return mine ? { ...i, isRead: s?.read ?? false, ...(s?.resolvedAt ? { resolvedAt: s.resolvedAt } : {}) } : { ...i, ...(s?.resolvedAt ? { resolvedAt: s.resolvedAt } : {}) };
      })
      .filter((i) => filter.includeResolved || !i.resolvedAt)
      .filter((i) => filter.read === undefined || !mine || i.isRead === filter.read)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const { items, pageInfo } = page(rows, Math.min(Math.max(filter.limit ?? 50, 1), 100), filter.cursor);
    return { items, pageInfo, unread: mine ? rows.filter((i) => !i.isRead).length : undefined };
  }

  /** Read and resolved flags of a gate for one person (the web inbox lists gates). */
  gateState(user: string, gateId: string): { read: boolean; resolved: boolean } {
    const s = this.k.store.get<InboxState>(C.inboxState, `${user}|gate:${gateId}`);
    return { read: s?.read ?? false, resolved: Boolean(s?.resolvedAt) };
  }

  private setState(user: string, ids: string[], patch: Partial<Pick<InboxState, "read" | "resolvedAt">> & { clearResolved?: boolean }) {
    const known = new Set(this.all().map((i) => i.id));
    return ids.map((given) => {
      // Bare gate ids (as the web inbox sends them) mean the gate's item.
      const itemId = known.has(given) || !known.has(`gate:${given}`) ? given : `gate:${given}`;
      if (!known.has(itemId)) return { id: given, ok: false };
      const id = `${user}|${itemId}`;
      const prev = this.k.store.get<InboxState>(C.inboxState, id);
      const next: InboxState = { id, user, itemId, read: prev?.read ?? false, ...(prev?.resolvedAt ? { resolvedAt: prev.resolvedAt } : {}), updatedAt: this.k.clock.now().toISOString() };
      if (patch.read !== undefined) next.read = patch.read;
      if (patch.resolvedAt) next.resolvedAt = patch.resolvedAt;
      if (patch.clearResolved) delete next.resolvedAt;
      this.k.store.put(C.inboxState, next);
      return { id: given, ok: true };
    });
  }

  markRead(user: string, ids: string[]) {
    return this.setState(user, ids, { read: true });
  }

  markUnread(user: string, ids: string[]) {
    return this.setState(user, ids, { read: false });
  }

  /** Hide an item for this person; `undo` brings it back. */
  resolve(user: string, ids: string[]) {
    return this.setState(user, ids, { read: true, resolvedAt: this.k.clock.now().toISOString() });
  }

  undoResolve(user: string, ids: string[]) {
    return this.setState(user, ids, { clearResolved: true });
  }
}
