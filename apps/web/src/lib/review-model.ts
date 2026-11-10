/**
 * What the review page shows for a task: a short answer to "what happened and can I approve it",
 * built from the work item and its runs. Pure, so it is tested without a server.
 */
export type ProofMedia = { kind: "image" | "video"; name: string; url: string };
export type Proof = {
  /** A before/after pair when the agent named its images that way. */
  before?: ProofMedia;
  after?: ProofMedia;
  /** A single image, when there is no pair. */
  image?: ProofMedia;
  video?: ProofMedia;
  /** Everything else, shown only on request. */
  more: ProofMedia[];
};
export type CheckLine = { ok: boolean; text: string };
export type StepLine = { id: string; agent: string; status: "done" | "running" | "failed"; minutes: number; summary?: string };
export type ReviewModel = {
  id: string;
  title: string;
  state: string;
  pr?: { repo: string; number: number; url: string; additions?: number; deletions?: number; changedFiles?: number };
  wrong?: string;
  proof: Proof;
  checks: CheckLine[];
  /** What the verify agent said its proof does not cover. */
  limits?: string;
  verdict?: string;
  notes: string[];
  steps: StepLine[];
  costUsd: number;
  minutes: number;
};

type ArtifactLike = { kind?: string; name: string; url: string; key?: string; contentType?: string };
export type ReviewRunLike = {
  id: string;
  agent: string;
  stage?: string;
  status: string;
  startedAt: string;
  finishedAt?: string;
  costUsd?: number;
  summary?: string;
  artifacts?: ArtifactLike[];
  result?: unknown;
};
export type ReviewWorkItemLike = {
  id: string;
  title: string;
  state: string;
  costUsd?: number;
  createdAt: string;
  updatedAt?: string;
  pr?: ReviewModel["pr"];
  triage?: { summary?: string };
  review?: { verdict: string; findings: string[] };
  runs: ReviewRunLike[];
};

const GENERIC_VIDEO = /^(video|recording|trace)\.[a-z0-9]+$/i;

function media(a: ArtifactLike): ProofMedia | undefined {
  const image = a.kind === "image" || a.contentType?.startsWith("image/");
  const video = a.kind === "video" || a.contentType?.startsWith("video/");
  if (!image && !video) return undefined;
  return { kind: image ? "image" : "video", name: a.name, url: a.key ? `/files/${a.key}` : a.url };
}

/** One before/after pair (or one image) and one video; the rest goes to `more`. */
export function pickProof(items: ProofMedia[]): Proof {
  const seen = new Set<string>();
  const unique = items.filter((m) => (seen.has(m.url) ? false : (seen.add(m.url), true)));
  const images = unique.filter((m) => m.kind === "image");
  const videos = unique.filter((m) => m.kind === "video");
  const befores = images.filter((m) => /before/i.test(m.name));
  let before: ProofMedia | undefined;
  let after: ProofMedia | undefined;
  for (const b of befores) {
    const twin = b.name.replace(/before/i, (w) => (w === "BEFORE" ? "AFTER" : w[0] === "B" ? "After" : "after"));
    const a = images.find((m) => m.name === twin);
    if (a) {
      before = b;
      after = a;
      break;
    }
  }
  if (!before && befores[0]) {
    const a = images.find((m) => /after/i.test(m.name));
    if (a) {
      before = befores[0];
      after = a;
    }
  }
  const image = before ? undefined : images[0];
  const video = videos.find((v) => !GENERIC_VIDEO.test(v.name)) ?? videos[0];
  const shown = new Set([before, after, image, video].filter(Boolean).map((m) => m!.url));
  return { before, after, image, video, more: unique.filter((m) => !shown.has(m.url)) };
}

const asRecord = (v: unknown): Record<string, unknown> | undefined => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined);

/** Test lines from a verify result: `tests` may be a list of lines or a name → outcome map. */
export function checkLines(result: unknown): CheckLine[] {
  const r = asRecord(result);
  if (!r) return [];
  const ok = r.testsPassed !== false;
  const tests = r.tests;
  if (Array.isArray(tests)) return tests.filter((t): t is string => typeof t === "string").map((text) => ({ ok, text }));
  const map = asRecord(tests);
  if (map) return Object.entries(map).map(([k, v]) => ({ ok, text: typeof v === "string" ? `${k}: ${v}` : k }));
  return typeof r.testsPassed === "boolean" ? [{ ok, text: ok ? "Tests pass" : "Tests fail" }] : [];
}

const minutesBetween = (a: string, b?: string) => (b ? Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60_000)) : 0);

export function buildReviewModel(wi: ReviewWorkItemLike): ReviewModel {
  const runs = [...wi.runs].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  // Proof comes from the latest run that produced any, so a re-verify replaces the first attempt.
  const mediaOf = (r: ReviewRunLike) => (r.artifacts ?? []).map(media).filter((m): m is ProofMedia => Boolean(m));
  const newestFirst = [...runs].reverse();
  const proof = pickProof(mediaOf(newestFirst.find((r) => mediaOf(r).length > 0) ?? { id: "", agent: "", status: "", startedAt: "" }));
  // A re-verify may attach images only; keep the recording an earlier attempt made.
  if (!proof.video) proof.video = newestFirst.flatMap(mediaOf).find((m) => m.kind === "video" && !GENERIC_VIDEO.test(m.name)) ?? newestFirst.flatMap(mediaOf).find((m) => m.kind === "video");
  const verify = [...runs].reverse().find((r) => r.stage === "verify" || r.agent === "verify");
  const result = asRecord(verify?.result);
  const checks = checkLines(verify?.result);
  if (wi.review) checks.push({ ok: wi.review.verdict === "accepted", text: wi.review.verdict === "accepted" ? "Review agent accepted" : `Review agent: ${wi.review.verdict}` });
  const last = runs.at(-1);
  return {
    id: wi.id,
    title: wi.title,
    state: wi.state,
    pr: wi.pr,
    wrong: wi.triage?.summary,
    proof,
    checks,
    limits: typeof result?.notes === "string" ? result.notes : undefined,
    verdict: wi.review?.verdict,
    notes: wi.review?.findings ?? [],
    steps: runs.map((r) => ({
      id: r.id,
      agent: r.agent,
      status: r.status === "running" ? "running" : r.status === "failed" ? "failed" : "done",
      minutes: minutesBetween(r.startedAt, r.finishedAt),
      summary: r.summary,
    })),
    costUsd: wi.costUsd ?? runs.reduce((n, r) => n + (r.costUsd ?? 0), 0),
    minutes: minutesBetween(wi.createdAt, last?.finishedAt ?? wi.updatedAt),
  };
}
