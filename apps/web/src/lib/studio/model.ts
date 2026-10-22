/** What the Studio page shows, computed from the API's shapes. Pure functions, tested in model.test.ts. */
import { parsePatch, type DiffLine } from "@/lib/diff";
import type { RunStatus } from "@/lib/run-tree";
import type { AppPullRequest, AppSource, Chat, ChatMode, MergeReview, Preview, PullRequestState, ShipMode, StatusReport, StudioApp, Turn, Version } from "./types";

export const MODES: { id: ChatMode; label: string; hint: string }[] = [
  { id: "build", label: "Build", hint: "Reads, edits and runs the app" },
  { id: "chat", label: "Chat", hint: "Reads only" },
  { id: "plan", label: "Plan", hint: "Reads, then writes a plan" },
];

/** ⌥P: Build → Chat → Plan → Build. */
export function nextMode(mode: ChatMode): ChatMode {
  const i = MODES.findIndex((m) => m.id === mode);
  return MODES[(i + 1) % MODES.length]!.id;
}

export const SHIP_MODES: ShipMode[] = ["safe", "review", "cowboy"];

/** A template project starts in Cowboy; an imported repository is real code, so it starts in Review. */
export function defaultShipMode(source?: AppSource): ShipMode {
  return source?.kind === "repo" ? "review" : "cowboy";
}

export const SHIP_MODE_COPY: Record<ShipMode, { label: string; line: string }> = {
  safe: { label: "Safe", line: "Nothing leaves the sandbox until you ship" },
  review: { label: "Review", line: "Opens a pull request for review" },
  cowboy: { label: "Cowboy", line: "Pushes straight to main" },
};

/** Ship mode labels and their one line, in one place. */
export function shipModeCopy(mode: ShipMode): { label: string; line: string } {
  return SHIP_MODE_COPY[mode];
}

/** Choosing Cowboy on an imported repository needs a confirmation; this is its text. */
export function cowboyConfirmation(source: AppSource | undefined): string | undefined {
  return source?.kind === "repo" ? `Changes will push straight to main of ${source.repo}.` : undefined;
}

export function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "project"
  );
}

/** How a finished turn ends in the chat: a version card, a question, a plan card, a note or nothing. */
export type TurnCard = "version" | "question" | "plan" | "discarded" | "failed" | "none";

export function turnCard(t: Turn): TurnCard {
  if (t.status === "running") return "none";
  if (t.status === "failed") return "failed";
  if (t.question) return "question";
  if (t.plan) return "plan";
  if (t.checkpoint && !t.discarded) return "version";
  if (t.discarded) return "discarded";
  return "none";
}

/**
 * The version a turn's checkpoint landed in: the first version from the turn's chat made at or after
 * the turn finished and before the chat's next checkpointed turn finished. Undefined until applied.
 */
export function versionForTurn(turn: Turn, turns: Turn[], versions: Version[]): Version | undefined {
  if (!turn.checkpoint || !turn.finishedAt) return undefined;
  const later = turns
    .filter((t) => t.chatId === turn.chatId && t.checkpoint && t.finishedAt && t.finishedAt > turn.finishedAt!)
    .map((t) => t.finishedAt!)
    .sort()[0];
  return versions
    .filter((v) => v.chatId === turn.chatId && v.kind === "apply" && v.createdAt >= turn.finishedAt! && (!later || v.createdAt < later))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
}

/** Checkpointed turns after the chat's last apply: what Apply would merge. */
export function unappliedTurns(chat: Chat, turns: Turn[]): Turn[] {
  const mine = turns.filter((t) => t.chatId === chat.id && t.checkpoint && !t.discarded);
  if (!chat.appliedSha) return mine;
  const i = mine.findIndex((t) => t.checkpoint === chat.appliedSha);
  return i === -1 ? mine : mine.slice(i + 1);
}

/** v1 is the oldest version. `versions` may be in any order. */
export function versionNumber(versions: Version[], id: string): number {
  const sorted = [...versions].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return sorted.findIndex((v) => v.id === id) + 1;
}

/** Versions newest first, grouped under "Today", "Yesterday" or a date. */
export function groupByDay(versions: Version[], now: Date): { label: string; versions: Version[] }[] {
  const groups: { label: string; versions: Version[] }[] = [];
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const today = day(now);
  for (const v of [...versions].sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
    const d = new Date(v.createdAt);
    const diff = Math.round((today - day(d)) / 86_400_000);
    const label = diff <= 0 ? "Today" : diff === 1 ? "Yesterday" : d.toLocaleDateString("en", { month: "short", day: "numeric" });
    const last = groups[groups.length - 1];
    if (last?.label === label) last.versions.push(v);
    else groups.push({ label, versions: [v] });
  }
  return groups;
}

export function needsYouCount(status: StatusReport | undefined): number {
  return status?.apps.reduce((n, p) => n + p.needsYou.length, 0) ?? 0;
}

/** "Worked for 34s" once a turn is done, "Working" while it runs. */
export function workTitle(t: Turn): string {
  if (t.status === "running") return "Working";
  if (!t.finishedAt) return "Worked";
  const s = Math.max(1, Math.round((Date.parse(t.finishedAt) - Date.parse(t.startedAt)) / 1000));
  return s < 60 ? `Worked for ${s}s` : `Worked for ${Math.floor(s / 60)}m ${s % 60}s`;
}

/** The preview iframe's src: the dev server URL with `route` as its path, keeping the URL's query. */
export function previewSrc(url: string, route: string): string {
  const path = route.startsWith("/") ? route : `/${route}`;
  if (path === "/") return url;
  const [base, query] = url.split("?", 2) as [string, string | undefined];
  return `${base.replace(/\/$/, "")}${path}${query ? `?${query}` : ""}`;
}

export type DiffFile = { path: string; status: "added" | "deleted" | "modified"; lines: DiffLine[]; additions: number; deletions: number };

/** A `git diff` split per file, with its parsed lines. */
export function splitDiff(diff: string): DiffFile[] {
  const files: DiffFile[] = [];
  const chunks = diff.split(/^diff --git /m).filter((c) => c.trim());
  for (const chunk of chunks) {
    const head = /^a\/(\S+) b\/(\S+)/.exec(chunk);
    if (!head) continue;
    const added = /^new file mode/m.test(chunk);
    const deleted = /^deleted file mode/m.test(chunk);
    const hunkStart = chunk.search(/^@@/m);
    const lines = hunkStart === -1 ? [] : parsePatch(chunk.slice(hunkStart).replace(/\n$/, ""));
    files.push({
      path: deleted ? head[1]! : head[2]!,
      status: added ? "added" : deleted ? "deleted" : "modified",
      lines,
      additions: lines.filter((l) => l.kind === "add").length,
      deletions: lines.filter((l) => l.kind === "del").length,
    });
  }
  return files;
}

export type FileNode = { type: "file"; name: string; path: string } | { type: "folder"; name: string; path: string; children: FileNode[] };

/** A File Tree from paths: folders first, then files, each sorted by name. */
export function fileTree(paths: string[]): FileNode[] {
  const root: FileNode[] = [];
  for (const p of paths) {
    const parts = p.split("/");
    let level = root;
    parts.forEach((name, i) => {
      const path = parts.slice(0, i + 1).join("/");
      if (i === parts.length - 1) {
        level.push({ type: "file", name, path });
        return;
      }
      let folder = level.find((n): n is Extract<FileNode, { type: "folder" }> => n.type === "folder" && n.name === name);
      if (!folder) {
        folder = { type: "folder", name, path, children: [] };
        level.push(folder);
      }
      level = folder.children;
    });
  }
  const sort = (nodes: FileNode[]): FileNode[] =>
    nodes
      .map((n) => (n.type === "folder" ? { ...n, children: sort(n.children) } : n))
      .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "folder" ? -1 : 1));
  return sort(root);
}

/** Next.js routes a diff touches (`app/pricing/page.tsx` → `/pricing`), for the route picker. */
export function routesFrom(paths: string[]): string[] {
  const routes = new Set<string>(["/"]);
  for (const p of paths) {
    const m = /^(?:src\/)?app\/(.*?)\/?page\.(?:tsx|jsx|ts|js|mdx)$/.exec(p);
    if (!m) continue;
    const segs = m[1]!.split("/").filter((s) => s && !/^\(.*\)$/.test(s) && !s.startsWith("@"));
    routes.add(`/${segs.join("/")}`);
  }
  return [...routes].sort();
}

/** Spend across a chat's turns, for the Context pattern. */
export function chatUsage(turns: Turn[]): { total: number; byMode: Record<ChatMode, number>; turns: number } {
  const byMode: Record<ChatMode, number> = { build: 0, chat: 0, plan: 0 };
  for (const t of turns) byMode[t.mode] += t.costUsd;
  return { total: turns.reduce((n, t) => n + t.costUsd, 0), byMode, turns: turns.length };
}

export function usd(n: number): string {
  return n < 0.01 && n > 0 ? "<$0.01" : `$${n.toFixed(2)}`;
}

export type SetupStep = { id: "clone" | "install" | "dev" | "preview"; label: string; status: "pending" | "running" | "done" | "failed" };

/**
 * Import progress, derived from the app and its first preview: clone (until setup is detected),
 * install (until the app is ready), start the dev server, preview ready.
 */
export function importSteps(app: StudioApp, preview: Preview | undefined): SetupStep[] {
  const failed = app.status === "failed";
  const cloned = Boolean(app.setup) || app.status === "ready" || app.status === "paused";
  const installed = app.status === "ready" || app.status === "paused";
  const step = (id: SetupStep["id"], label: string, done: boolean, active: boolean): SetupStep => ({
    id,
    label,
    status: done ? "done" : active ? (failed ? "failed" : "running") : "pending",
  });
  const dev = step("dev", "Start the dev server", preview?.status === "ready", installed);
  return [
    step("clone", "Clone the repository", cloned, !cloned),
    step("install", app.setup ? `Install with ${app.setup.packageManager}` : "Install dependencies", installed, cloned && !installed),
    preview?.status === "failed" ? { ...dev, status: "failed" } : dev,
    step("preview", "Preview ready", preview?.status === "ready", false),
  ];
}

/** A chat's status as a run's (the Tasks panel shows chats with the run tree's visuals). */
export function chatRunStatus(c: Chat, lastTurn?: Turn): RunStatus {
  if (c.status === "working") return "running";
  if (c.status === "needs_you" || c.status === "conflict") return "blocked";
  if (c.status === "failed") return "failed";
  if (lastTurn?.status === "cancelled") return "cancelled";
  return "complete";
}


export const PULL_REQUEST_LABEL: Record<PullRequestState, string> = {
  uat: "UAT",
  ready_for_review: "Ready for review",
  waiting_for_review: "Waiting for review",
  merged: "Merged",
  cancelled: "Cancelled",
};

export type PrStep = { label: string; status: "done" | "current" | "waiting" | "cancelled" | "todo" };

/** The pull request's path for its author: UAT → Ready for review → Merged, or Waiting for review, or Cancelled. */
export function prSteps(state: PullRequestState, mergedLabel = "Merged"): PrStep[] {
  const after = state === "waiting_for_review" ? { label: "Waiting for review", status: "waiting" as const } : { label: state === "merged" ? mergedLabel : "Merged", status: state === "merged" ? ("done" as const) : ("todo" as const) };
  if (state === "cancelled") return [{ label: "UAT", status: "done" }, { label: "Cancelled", status: "cancelled" }];
  return [
    { label: "UAT", status: state === "uat" ? "current" : "done" },
    { label: "Ready for review", status: state === "uat" ? "todo" : state === "ready_for_review" ? "current" : "done" },
    after,
  ];
}

/** "Merged by the merge gate" when the gate merged it, "Merged by <person>" when the record says who, else "Merged". */
export function mergedLabel(review: Pick<MergeReview, "state" | "decision" | "mergedBy"> | undefined): string {
  if (review?.state !== "merged") return "Merged";
  if (review.decision?.action === "merge") return "Merged by the merge gate";
  return review.mergedBy ? `Merged by ${review.mergedBy}` : "Merged";
}

/** The gate's review of an App's pull request: by its Studio id, else by repository and number. */
export function reviewFor(reviews: MergeReview[], pr: Pick<AppPullRequest, "id" | "repo" | "number">): MergeReview | undefined {
  return reviews.find((r) => r.pullRequestId === pr.id) ?? reviews.find((r) => r.repo === pr.repo && r.number === pr.number);
}
