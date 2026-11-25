import type { ChangeSetRepo, PullRequestRef, WorkItem } from "./types";

/**
 * A work item changes a set of repositories (ADR-020). `repos`, `prs` and `previews` are the
 * truth; `repo`, `pr` and `previewUrl` mirror the first entry for older readers and are written
 * only here.
 */

/** Rows stored before ADR-020 read as a change set of one. Idempotent. */
export function migrateWorkItem<T extends WorkItem>(wi: T): T {
  if (!wi.repos && (wi.repo || wi.pr)) wi.repos = [{ repo: wi.repo ?? wi.pr!.repo, role: "changed" }];
  if (!wi.prs && wi.pr) wi.prs = [{ ...wi.pr }];
  if (!wi.previews && wi.previewUrl) wi.previews = [{ service: "app", url: wi.previewUrl, status: "ready" }];
  return wi;
}

/** Changed repositories first (in the given order), then context ones; one entry per repository. */
export function setRepos(wi: WorkItem, repos: ChangeSetRepo[]) {
  const byRepo = new Map<string, ChangeSetRepo>();
  for (const r of repos) {
    const key = r.repo.toLowerCase();
    const seen = byRepo.get(key);
    if (!seen || (seen.role === "context" && r.role === "changed")) byRepo.set(key, { ...seen, ...r, role: seen?.role === "changed" ? "changed" : r.role });
  }
  const all = [...byRepo.values()];
  wi.repos = [...all.filter((r) => r.role === "changed"), ...all.filter((r) => r.role === "context")];
  wi.repo = wi.repos[0]?.repo;
}

/** Add a repository to the changed set when a run changed it; true when it was not in the set yet. */
export function joinChangeSet(wi: WorkItem, repo: string): boolean {
  migrateWorkItem(wi);
  const found = wi.repos?.find((r) => r.repo.toLowerCase() === repo.toLowerCase());
  if (found?.role === "changed") return false;
  setRepos(wi, [...(wi.repos ?? []), { repo, role: "changed" }]);
  return true;
}

/** The changed repositories of a work item, in order. */
export function changedRepos(wi: WorkItem): string[] {
  return (migrateWorkItem(wi).repos ?? []).filter((r) => r.role === "changed").map((r) => r.repo);
}

/** Record a pull request (new or updated) and keep `pr` pointing at the first one. */
export function upsertPr(wi: WorkItem, pr: PullRequestRef): PullRequestRef {
  migrateWorkItem(wi);
  const prs = wi.prs ?? [];
  const i = prs.findIndex((p) => p.repo.toLowerCase() === pr.repo.toLowerCase());
  const next = i >= 0 ? { ...prs[i], ...pr } : pr;
  if (i >= 0) prs[i] = next;
  else prs.push(next);
  wi.prs = prs;
  wi.pr = prs[0];
  return next;
}

/** The pull request of a work item in one repository. */
export function prFor(wi: WorkItem, repo: string): PullRequestRef | undefined {
  return migrateWorkItem(wi).prs?.find((p) => p.repo.toLowerCase() === repo.toLowerCase());
}

const START = "<!-- kiln:change-set -->";
const END = "<!-- /kiln:change-set -->";

/** The `## Change set` section of a pull request body; empty for a change set of one. */
export function changeSetSection(prs: PullRequestRef[], self: string): string {
  if (prs.length < 2) return "";
  const lines = prs.map((p) => {
    const name = `${p.repo}#${p.number}`;
    const state = p.mergedAt ? " (merged)" : p.closedAt ? " (closed)" : "";
    return p.repo.toLowerCase() === self.toLowerCase() ? `- ${name} (this pull request)${state}` : `- [${name}](${p.url})${state}`;
  });
  return [START, "## Change set", "", "These pull requests ship one change together; review and merge them as a set.", "", ...lines, END].join("\n");
}

/** `body` with its change set section written (or replaced, or removed for a set of one). */
export function withChangeSetSection(body: string, prs: PullRequestRef[], self: string): string {
  const section = changeSetSection(prs, self);
  const start = body.indexOf(START);
  const end = body.indexOf(END);
  const without = start >= 0 && end > start ? (body.slice(0, start) + body.slice(end + END.length)).replace(/\n{3,}/g, "\n\n").trimEnd() : body.trimEnd();
  return section ? `${without}\n\n${section}\n` : `${without}\n`;
}

/** Whether a pull request belongs to a work item's change set. */
export function hasPullRequest(wi: WorkItem, repo: string, number: number): boolean {
  return (wi.prs ?? (wi.pr ? [wi.pr] : [])).some((p) => p.repo.toLowerCase() === repo.toLowerCase() && p.number === number);
}
