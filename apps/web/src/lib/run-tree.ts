/**
 * The Runs list model. A work item is the root foreman run; the agent runs it started are its
 * children, and subagents nest under the run that spawned them (`parentRunId`). Runs without a
 * work item (benchmarks, self-improvement, scorers) are roots of their own.
 * Pure functions only: the page and the tests share them.
 */

export type RunStatus = "running" | "complete" | "failed" | "blocked" | "cancelled";
export const RUN_STATUSES: RunStatus[] = ["running", "complete", "failed", "blocked", "cancelled"];
export const STATUS_LABEL: Record<RunStatus, string> = { running: "Running", complete: "Complete", failed: "Failed", blocked: "Blocked", cancelled: "Cancelled" };

export type ArtifactLike = { kind: string; name: string; url: string; key?: string; contentType?: string };

export type WorkItemLike = {
  id: string;
  factory: string;
  title: string;
  state: string;
  source: { provider: string; url?: string };
  requester: string;
  pr?: { repo: string; number: number; url: string };
  previewUrl?: string;
  costUsd: number;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  blockedReason?: string;
};

export type RunLike = {
  id: string;
  kind: string;
  factory: string;
  workItemId?: string;
  agent: string;
  agentType?: string;
  stage?: string;
  parentRunId?: string;
  rootRunId?: string;
  title?: string;
  source?: string;
  summary?: string;
  status: string;
  artifacts?: ArtifactLike[];
  costUsd: number;
  startedAt: string;
  finishedAt?: string;
  createdBy?: string;
};

export type RunRow = {
  id: string;
  href: string;
  title: string;
  status: RunStatus;
  /** Why the task waits (blocked reason), shown next to its status. */
  statusNote?: string;
  /** On the latest run of a step that ran more than once: how many times it ran. */
  attempts?: number;
  /** On an earlier, superseded run of a step: which attempt it was (1 = first). */
  attempt?: number;
  factory: string;
  /** Agent names in this row (the root foreman row carries "foreman"). */
  agent: string;
  source: string;
  creator: string;
  createdAt: string;
  updatedAt: string;
  costUsd: number;
  prUrl?: string;
  images: number;
  videos: number;
  children: RunRow[];
};

/** Only live runs (running or waiting on someone) can be cancelled. */
export function canCancel(row: Pick<RunRow, "status">): boolean {
  return row.status === "running" || row.status === "blocked";
}

const RUNNING_STATES = ["received", "triaging", "planning", "building", "reviewing"];
const WAITING_STATES = ["awaiting_spec", "awaiting_preview", "blocked"];

export function workItemStatus(state: string): RunStatus {
  if (RUNNING_STATES.includes(state)) return "running";
  if (WAITING_STATES.includes(state)) return "blocked";
  if (state === "failed") return "failed";
  if (state === "cancelled") return "cancelled";
  return "complete";
}

export function runStatus(status: string): RunStatus {
  if (status === "running") return "running";
  if (status === "succeeded") return "complete";
  if (status === "failed") return "failed";
  if (status === "paused") return "blocked";
  return "cancelled";
}

const SOURCE_LABEL: Record<string, string> = {
  kiln: "Kiln Web",
  web: "Kiln Web",
  api: "API",
  mcp: "Factory MCP",
  cli: "CLI",
  slack: "Slack",
  teams: "Teams",
  linear: "Linear",
  jira: "Jira",
  github: "GitHub",
  github_action: "GitHub Action",
  gitlab: "GitLab",
  azure_devops: "Azure DevOps",
  schedule: "Scheduled",
  scheduled: "Scheduled",
  webhook: "Webhook",
  scorer: "Scorer",
  benchmark: "Benchmark",
  improver: "Self-improvement",
  self_improvement: "Self-improvement",
  orchestration: "Orchestration",
  replay: "Replay",
  local: "Kiln (local agent)",
};

/** Source filter options, in the order the filter menu shows them. */
export const SOURCES = ["linear", "slack", "teams", "api", "mcp", "local", "schedule", "kiln", "github_action", "github", "gitlab", "azure_devops", "cli", "jira", "scorer", "benchmark", "improver", "orchestration", "webhook"] as const;

export function sourceLabel(source: string): string {
  const key = source.toLowerCase();
  if (key === "web_app") return "Kiln Web";
  return SOURCE_LABEL[key] ?? source.charAt(0).toUpperCase() + source.slice(1);
}

/** Where a run came from: explicit `source`, else derived from its kind (child runs are orchestration). */
export function runSource(run: RunLike): string {
  // Runs the foreman launched for a work item inherit the request's source from the API; they are orchestration.
  if ((run.workItemId || run.parentRunId) && run.kind === "work") return "orchestration";
  if (run.source) return run.source;
  if (run.kind === "benchmark") return "benchmark";
  if (run.kind === "improver") return "improver";
  if (run.kind === "replay") return "replay";
  return "orchestration";
}

export function agentDisplayName(agent: string, factoryName?: string): string {
  const name = agent
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
  return `${factoryName ? `${factoryName} ` : ""}${name} Agent`;
}

export function runTitle(run: RunLike, workItemTitle?: string): string {
  // The API echoes the work item title on its runs; name those by their stage instead.
  if (run.title && run.title !== workItemTitle) return run.title;
  const what = run.stage ?? run.agent;
  const verb: Record<string, string> = { triage: "Triage", spec: "Write spec for", build: "Build", implement: "Implement", verify: "Verify", review: "Review", plan: "Plan" };
  const v = verb[run.agent] ?? verb[what] ?? what.charAt(0).toUpperCase() + what.slice(1);
  return workItemTitle ? `${v} ${workItemTitle}` : `${v} run`;
}

/** "1 Image, 1 Video" style label; undefined when there is nothing to show. */
export function mediaChipLabel(images: number, videos: number): string | undefined {
  const parts: string[] = [];
  if (images) parts.push(`${images} Image${images === 1 ? "" : "s"}`);
  if (videos) parts.push(`${videos} Video${videos === 1 ? "" : "s"}`);
  return parts.length ? parts.join(", ") : undefined;
}

export function countMedia(artifacts: ArtifactLike[] = []): { images: number; videos: number } {
  let images = 0;
  let videos = 0;
  for (const a of artifacts) {
    if (a.kind === "image" || a.contentType?.startsWith("image/")) images++;
    else if (a.kind === "video" || a.contentType?.startsWith("video/")) videos++;
  }
  return { images, videos };
}

function prFrom(artifacts: ArtifactLike[] = []): string | undefined {
  return artifacts.find((a) => a.kind === "pr")?.url;
}

function runRow(run: RunLike, wi: WorkItemLike | undefined, byParent: Map<string, RunLike[]>): RunRow {
  const media = countMedia(run.artifacts);
  const kids = (byParent.get(run.id) ?? []).map((c) => runRow(c, wi, byParent));
  return {
    id: run.id,
    href: `/runs/${run.id}`,
    title: runTitle(run, wi?.title),
    status: runStatus(run.status),
    factory: run.factory,
    agent: run.agent,
    source: runSource(run),
    creator: run.createdBy ?? wi?.requester ?? "",
    createdAt: run.startedAt,
    updatedAt: run.finishedAt ?? run.startedAt,
    costUsd: run.costUsd,
    prUrl: prFrom(run.artifacts),
    images: media.images,
    videos: media.videos,
    children: kids,
  };
}

/**
 * Repeated runs of the same step (same agent and stage) fold into one row: the latest attempt,
 * placed where it ran, with the earlier attempts (newest first) under it after its own subagents.
 */
function foldAttempts(rows: RunRow[], runs: RunLike[]): RunRow[] {
  const key = (r: RunLike) => `${r.agent}|${r.stage ?? ""}`;
  const groups = new Map<string, RunRow[]>();
  runs.forEach((r, i) => groups.set(key(r), [...(groups.get(key(r)) ?? []), rows[i]!]));
  return runs.flatMap((r, i) => {
    const group = groups.get(key(r))!;
    const latest = group[group.length - 1]!;
    if (latest !== rows[i]) return [];
    if (group.length === 1) return [latest];
    const earlier = group.slice(0, -1).map((row, n) => ({ ...row, attempt: n + 1 })).reverse();
    return [{ ...latest, attempts: group.length, children: [...latest.children, ...earlier] }];
  });
}

/** Steps under a task, for its count badge: each step once, with its subagents, not every attempt. */
export function stepCount(rows: RunRow[]): number {
  return rows.reduce((n, r) => (r.attempt ? n : n + 1 + stepCount(r.children)), 0);
}

export function buildRunRows(workItems: WorkItemLike[], runs: RunLike[]): RunRow[] {
  const ids = new Set(runs.map((r) => r.id));
  const byParent = new Map<string, RunLike[]>();
  const byWorkItem = new Map<string, RunLike[]>();
  const standalone: RunLike[] = [];
  for (const r of [...runs].sort((a, b) => a.startedAt.localeCompare(b.startedAt))) {
    if (r.parentRunId && ids.has(r.parentRunId)) byParent.set(r.parentRunId, [...(byParent.get(r.parentRunId) ?? []), r]);
    else if (r.workItemId) byWorkItem.set(r.workItemId, [...(byWorkItem.get(r.workItemId) ?? []), r]);
    else standalone.push(r);
  }
  const rows: RunRow[] = workItems.map((wi) => {
    const own = byWorkItem.get(wi.id) ?? [];
    const children = foldAttempts(own.map((r) => runRow(r, wi, byParent)), own);
    const media = { images: 0, videos: 0 };
    for (const c of flatten(children)) {
      media.images += c.images;
      media.videos += c.videos;
    }
    return {
      id: wi.id,
      href: `/runs/${wi.id}`,
      title: wi.title,
      status: workItemStatus(wi.state),
      ...(wi.blockedReason ? { statusNote: wi.blockedReason } : {}),
      factory: wi.factory,
      agent: "foreman",
      source: wi.source.provider,
      creator: wi.requester,
      createdAt: wi.createdAt,
      updatedAt: wi.updatedAt,
      costUsd: wi.costUsd,
      prUrl: wi.pr?.url,
      images: media.images,
      videos: media.videos,
      children,
    };
  });
  // Runs whose work item is not in the list (other factory, filtered out) still show, as roots.
  const known = new Set(workItems.map((w) => w.id));
  for (const [wid, list] of byWorkItem) if (!known.has(wid)) standalone.push(...list);
  for (const r of standalone) {
    const row = runRow(r, undefined, byParent);
    rows.push({ ...row, source: r.source ?? (r.kind === "work" ? "api" : runSource(r)) });
  }
  return rows;
}

export function flatten(rows: RunRow[]): RunRow[] {
  return rows.flatMap((r) => [r, ...flatten(r.children)]);
}

export type SortKey = "updated" | "created" | "title" | "agent";
export type RunFilters = {
  mine?: boolean;
  me?: string;
  status?: RunStatus[];
  agent?: string[];
  factory?: string[];
  source?: string[];
  creator?: string[];
  q?: string;
  from?: string;
  to?: string;
  sort?: SortKey;
  dir?: "asc" | "desc";
};

function rowMatches(row: RunRow, f: RunFilters): boolean {
  if (f.status?.length && !f.status.includes(row.status)) return false;
  if (f.agent?.length && !f.agent.includes(row.agent)) return false;
  if (f.source?.length && !f.source.includes(row.source)) return false;
  return true;
}

/**
 * Filters apply to root rows. Status, agent and source also match when a child matches, so a
 * parent stays visible with only its matching children.
 */
export function filterRows(rows: RunRow[], f: RunFilters): RunRow[] {
  const q = f.q?.trim().toLowerCase();
  const out: RunRow[] = [];
  for (const row of rows) {
    if (f.mine && f.me && row.creator !== f.me) continue;
    if (f.creator?.length && !f.creator.includes(row.creator)) continue;
    if (f.factory?.length && !f.factory.includes(row.factory)) continue;
    const day = row.createdAt.slice(0, 10);
    if (f.from && day < f.from) continue;
    if (f.to && day > f.to) continue;
    if (q && !`${row.title} ${row.id}`.toLowerCase().includes(q) && !flatten(row.children).some((c) => c.title.toLowerCase().includes(q))) continue;
    if (rowMatches(row, f)) {
      out.push(row);
      continue;
    }
    const kids = filterChildren(row.children, f);
    if (kids.length) out.push({ ...row, children: kids });
  }
  return sortRows(out, f.sort ?? "updated", f.dir ?? "desc");
}

function filterChildren(rows: RunRow[], f: RunFilters): RunRow[] {
  return rows.flatMap((r) => {
    // A superseded attempt does not speak for the task: the latest attempt's row does.
    if (r.attempt) return [];
    if (rowMatches(r, f)) return [r];
    const kids = filterChildren(r.children, f);
    return kids.length ? [{ ...r, children: kids }] : [];
  });
}

export function sortRows(rows: RunRow[], key: SortKey, dir: "asc" | "desc"): RunRow[] {
  const val = (r: RunRow) => (key === "updated" ? r.updatedAt : key === "created" ? r.createdAt : key === "title" ? r.title.toLowerCase() : r.agent);
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => sign * val(a).localeCompare(val(b)));
}

// ---- URL state ----

const list = (v: string | null | undefined) => (v ? v.split(",").filter(Boolean) : undefined);

/** Statuses the default view shows: finished work (Complete, Cancelled) is hidden until asked for. */
export const DEFAULT_STATUSES: RunStatus[] = ["running", "failed", "blocked"];

/** Reads the Runs filters from the URL. With no parameters at all, "My runs" and the active statuses are on. */
export function parseRunFilters(sp: URLSearchParams | Record<string, string | string[] | undefined>): RunFilters {
  const get = (k: string): string | undefined => {
    if (sp instanceof URLSearchParams) return sp.get(k) ?? undefined;
    const v = sp[k];
    return Array.isArray(v) ? v[0] : v;
  };
  const keys = sp instanceof URLSearchParams ? [...sp.keys()] : Object.keys(sp).filter((k) => sp[k] !== undefined);
  const created = get("createdOn")?.split(".");
  const isDefault = keys.length === 0;
  return {
    mine: isDefault ? true : get("mine") === "1",
    status: isDefault ? [...DEFAULT_STATUSES] : list(get("status"))?.filter((s): s is RunStatus => (RUN_STATUSES as string[]).includes(s)),
    agent: list(get("agent")),
    factory: list(get("factory")),
    source: list(get("source")),
    creator: list(get("creator")),
    q: get("q") || undefined,
    from: created?.[0] || undefined,
    to: created?.[1] || undefined,
    sort: (["updated", "created", "title", "agent"] as const).find((s) => s === get("sort")),
    dir: get("dir") === "asc" ? "asc" : get("dir") === "desc" ? "desc" : undefined,
  };
}

export function runFiltersToQuery(f: RunFilters, opts: { createdChip?: boolean } = {}): string {
  const p = new URLSearchParams();
  if (f.mine) p.set("mine", "1");
  if (f.status?.length) p.set("status", f.status.join(","));
  if (f.agent?.length) p.set("agent", f.agent.join(","));
  if (f.factory?.length) p.set("factory", f.factory.join(","));
  if (f.source?.length) p.set("source", f.source.join(","));
  if (f.creator?.length) p.set("creator", f.creator.join(","));
  if (f.q) p.set("q", f.q);
  if (f.from || f.to || opts.createdChip) p.set("createdOn", `${f.from ?? ""}.${f.to ?? ""}`);
  if (f.sort && f.sort !== "updated") p.set("sort", f.sort);
  if (f.dir === "asc") p.set("dir", "asc");
  const s = p.toString();
  // An empty query means "default" (My runs and active statuses on); "all" keeps an explicitly cleared state.
  return s ? `?${s}` : "?all=1";
}

// ---- date range presets ----

export const DATE_PRESETS = ["Today", "Yesterday", "This week", "Last week", "This month", "Last month", "This year", "Last year", "All time"] as const;
export type DatePreset = (typeof DATE_PRESETS)[number];

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Inclusive [from, to] calendar days (local time) for a preset; All time is open on both ends. */
export function presetRange(preset: DatePreset, now = new Date()): { from?: string; to?: string } {
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();
  const day = (yy: number, mm: number, dd: number) => iso(new Date(yy, mm, dd));
  const dow = now.getDay();
  switch (preset) {
    case "Today":
      return { from: iso(now), to: iso(now) };
    case "Yesterday":
      return { from: day(y, m, d - 1), to: day(y, m, d - 1) };
    case "This week":
      return { from: day(y, m, d - dow), to: day(y, m, d - dow + 6) };
    case "Last week":
      return { from: day(y, m, d - dow - 7), to: day(y, m, d - dow - 1) };
    case "This month":
      return { from: day(y, m, 1), to: day(y, m + 1, 0) };
    case "Last month":
      return { from: day(y, m - 1, 1), to: day(y, m, 0) };
    case "This year":
      return { from: day(y, 0, 1), to: day(y, 11, 31) };
    case "Last year":
      return { from: day(y - 1, 0, 1), to: day(y - 1, 11, 31) };
    default:
      return {};
  }
}

/** "29 minutes ago", "about 1 hour ago" (date-fns formatDistanceToNow wording). */
export function relativeTime(at: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - new Date(at).getTime()) / 1000));
  const m = Math.round(s / 60);
  if (s < 30) return "less than a minute ago";
  if (m < 1) return "1 minute ago";
  if (m < 45) return `${m} minute${m === 1 ? "" : "s"} ago`;
  if (m < 90) return "about 1 hour ago";
  const h = Math.round(m / 60);
  if (h < 24) return `about ${h} hours ago`;
  const days = Math.round(h / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months} month${months === 1 ? "" : "s"} ago`;
  return `${Math.round(months / 12)} year${months < 18 ? "" : "s"} ago`;
}

/** "34m 31s", "1h 4m", "3s". */
export function shortDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

/** "34 minutes 31 seconds". */
export function longDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const parts: string[] = [];
  if (h) parts.push(`${h} hour${h === 1 ? "" : "s"}`);
  if (m) parts.push(`${m} minute${m === 1 ? "" : "s"}`);
  if (sec || parts.length === 0) parts.push(`${sec} second${sec === 1 ? "" : "s"}`);
  return parts.join(" ");
}
