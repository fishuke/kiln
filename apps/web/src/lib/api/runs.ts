import "server-only";
import { rawJson } from "./raw";

export type Attachment = { key: string; name: string; contentType: string; size: number };

/** One step of the run timeline (coming: GET /api/v1/runs/:id/timeline). */
export type TimelineSegment = { runId: string; agent: string; title?: string; status: string; startedAt: string; finishedAt?: string; costUsd?: number };

/** POST /api/v1/work-items with attachments (the attachments field is accepted once uploads land). */
export function createWorkItem(input: { factory: string; title: string; body: string; attachments: Attachment[] }) {
  return rawJson<{ id: string }>("POST", "/api/v1/work-items", { ...input, via: "kiln" });
}

/** Coming: POST /api/v1/runs/:id/followups {message, attachments}. */
export function followup(runId: string, message: string, attachments: Attachment[]) {
  return rawJson<{ ok?: boolean; runId?: string }>("POST", `/api/v1/runs/${encodeURIComponent(runId)}/followups`, { message, attachments });
}

/** Coming: GET /api/v1/runs/:id/timeline. */
export function timeline(runId: string) {
  return rawJson<TimelineSegment[]>("GET", `/api/v1/runs/${encodeURIComponent(runId)}/timeline`);
}

/** Coming: POST /api/v1/runs/:id/score. */
export function scoreRun(runId: string) {
  return rawJson<unknown>("POST", `/api/v1/runs/${encodeURIComponent(runId)}/score`, {});
}
