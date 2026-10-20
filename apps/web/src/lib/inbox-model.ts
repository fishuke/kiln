/**
 * Inbox model: open gates and stuck work become inbox items with a kind, read state and the
 * primary action the side pane offers. Pure functions shared by the page and the tests.
 */

export type InboxKind = "question" | "answer_question" | "spec_review" | "pr_review" | "blocked" | "failed";
export const INBOX_KINDS: InboxKind[] = ["question", "answer_question", "spec_review", "pr_review", "blocked", "failed"];
export const INBOX_KIND_LABEL: Record<InboxKind, string> = {
  question: "Asked question",
  answer_question: "Answered question",
  spec_review: "Spec review",
  pr_review: "PR review",
  blocked: "Blocked",
  failed: "Failed",
};

export type QuestionOption = { label: string; recommended?: boolean };

export type GateLike = {
  id: string;
  workItemId: string;
  factory: string;
  kind: string;
  title: string;
  question?: string;
  state: string;
  answer?: string;
  evidence: { label: string; url: string }[];
  openedAt: string;
  decidedAt?: string;
  command?: string;
  urgency?: number;
  assignees: string[];
  /** Coming: structured options for questions. */
  options?: (string | QuestionOption)[];
  multiSelect?: boolean;
  read?: boolean;
  resolved?: boolean;
  workItem?: { id: string; title: string; state: string; factory: string; pr?: { repo: string; number: number; url: string }; previewUrl?: string };
};

export type StuckWorkItem = { id: string; factory: string; title: string; state: string; blockedReason?: string; updatedAt: string; pr?: { url: string; repo: string; number: number }; read?: boolean };

export type InboxEntry = {
  /** The API's inbox item id (bare gate id for open gates), so read and resolve reach the API. */
  id: string;
  /** Gate id when the entry is a decision; absent for blocked/failed work. */
  gateId?: string;
  kind: InboxKind;
  title: string;
  body?: string;
  factory: string;
  workItemId: string;
  workItemTitle?: string;
  at: string;
  read: boolean;
  urgent: boolean;
  evidence: { label: string; url: string }[];
  prUrl?: string;
  previewUrl?: string;
  command?: string;
  options: QuestionOption[];
  multiSelect: boolean;
  gateKind?: string;
};

export function gateInboxKind(g: Pick<GateLike, "kind" | "state">): InboxKind {
  if (g.kind === "question") return g.state === "answered" ? "answer_question" : "question";
  if (g.kind === "spec") return "spec_review";
  return "pr_review";
}

/**
 * Options of a question. Uses structured `options` when the API sends them, else reads a
 * Markdown list from the question text ("- Postgres (recommended)", "1. SQLite").
 */
export function questionOptions(g: Pick<GateLike, "options" | "question">): QuestionOption[] {
  if (g.options?.length) return g.options.map((o) => (typeof o === "string" ? parseOption(o) : o));
  if (!g.question) return [];
  const out: QuestionOption[] = [];
  for (const line of g.question.split("\n")) {
    const m = /^\s*(?:[-*]|\d+[.)])\s+(?:\[[ x]\]\s+)?(.+?)\s*$/.exec(line);
    if (m) out.push(parseOption(m[1]!));
  }
  return out.length >= 2 ? out : [];
}

function parseOption(text: string): QuestionOption {
  const rec = /\s*[([]\s*recommended\s*[)\]]\s*$|\s*[-–—]\s*recommended\s*$|\s*\*\*recommended\*\*\s*$/i;
  return rec.test(text) ? { label: text.replace(rec, "").trim(), recommended: true } : { label: text.trim() };
}

/** Question text without the option list, for the pane body. */
export function questionPrompt(question: string | undefined): string {
  if (!question) return "";
  if (questionOptions({ question }).length === 0) return question;
  return question
    .split("\n")
    .filter((l) => !/^\s*(?:[-*]|\d+[.)])\s+/.test(l))
    .join("\n")
    .trim();
}

export function gateEntry(g: GateLike): InboxEntry {
  const kind = gateInboxKind(g);
  return {
    id: kind === "answer_question" ? `answer:${g.id}` : g.id,
    gateId: g.id,
    kind,
    title: g.title,
    body: g.command ? undefined : kind === "question" ? questionPrompt(g.question) : g.question,
    factory: g.factory,
    workItemId: g.workItemId,
    workItemTitle: g.workItem?.title,
    at: g.decidedAt ?? g.openedAt,
    read: Boolean(g.read),
    urgent: (g.urgency ?? 0) >= 0.8,
    evidence: g.evidence,
    prUrl: g.workItem?.pr?.url ?? g.evidence.find((e) => /pull|merge_requests/.test(e.url))?.url,
    previewUrl: g.workItem?.previewUrl ?? g.evidence.find((e) => e.label.toLowerCase() === "preview")?.url,
    command: g.command,
    options: g.kind === "question" && !g.command ? questionOptions(g) : [],
    multiSelect: Boolean(g.multiSelect),
    gateKind: g.kind,
  };
}

/** Blocked and failed work only shows when nothing else on that work item needs you. */
export function buildInbox(gates: GateLike[], stuck: StuckWorkItem[]): InboxEntry[] {
  const entries = gates.filter((g) => !g.resolved).map(gateEntry);
  const withGate = new Set(entries.map((e) => e.workItemId));
  for (const w of stuck) {
    if (withGate.has(w.id) || (w.state !== "blocked" && w.state !== "failed")) continue;
    const kind = w.state === "failed" ? "failed" : "blocked";
    entries.push({
      id: `task:${w.id}:${kind}`,
      kind,
      title: w.title,
      body: w.blockedReason,
      factory: w.factory,
      workItemId: w.id,
      workItemTitle: w.title,
      at: w.updatedAt,
      read: Boolean(w.read),
      urgent: false,
      evidence: [],
      prUrl: w.pr?.url,
      options: [],
      multiSelect: false,
    });
  }
  return entries.sort((a, b) => Number(b.urgent) - Number(a.urgent) || b.at.localeCompare(a.at));
}

export type InboxFilters = { factory?: string[]; read?: ("read" | "unread")[]; kind?: InboxKind[]; q?: string };

export function filterInbox(entries: InboxEntry[], f: InboxFilters): InboxEntry[] {
  const q = f.q?.trim().toLowerCase();
  return entries.filter((e) => {
    if (f.factory?.length && !f.factory.includes(e.factory)) return false;
    if (f.read && !f.read.includes(e.read ? "read" : "unread")) return false;
    if (f.kind && !f.kind.includes(e.kind)) return false;
    if (q && !`${e.title} ${e.body ?? ""} ${e.workItemTitle ?? ""}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

/** The pane's primary action label. */
export function primaryAction(e: Pick<InboxEntry, "kind" | "gateKind" | "command">): string {
  if (e.command) return "Run it";
  if (e.kind === "question") return "Answer";
  if (e.kind === "spec_review") return "Approve spec";
  if (e.gateKind === "preview") return "Accept preview";
  if (e.gateKind === "merge") return "Confirm it landed";
  if (e.kind === "pr_review") return "Approve";
  return "View run";
}
