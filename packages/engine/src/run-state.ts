import type { Run, RunKind, RunSource, RunState, Source, TaskStage, WorkItem } from "./types";

const PROVIDER_SOURCE: Record<Source["provider"], RunSource> = {
  github: "GITHUB_WEBHOOK",
  gitlab: "GITLAB_WEBHOOK",
  azure_devops: "AZURE_DEVOPS_WEBHOOK",
  bitbucket: "API",
  linear: "LINEAR",
  jira: "JIRA",
  slack: "SLACK",
  teams: "TEAMS",
  discord: "DISCORD",
  kiln: "WEB_APP",
  mcp: "MCP",
  schedule: "SCHEDULED_AGENT",
  webhook: "CUSTOM_WEBHOOK",
  api: "API",
  cli: "CLI",
};

const KIND_SOURCE: Partial<Record<RunKind, RunSource>> = { improver: "SELF_IMPROVEMENT", benchmark: "BENCHMARK_TRIAL" };

/** The source of a run: explicit, else from its kind, its parent or the work item's origin. */
export function sourceFor(input: { source?: RunSource; kind?: RunKind; parentRunId?: string; workItem?: Pick<WorkItem, "source"> }): RunSource {
  if (input.source) return input.source;
  if (input.kind && KIND_SOURCE[input.kind]) return KIND_SOURCE[input.kind]!;
  if (input.parentRunId) return "ORCHESTRATION";
  if (input.workItem) return PROVIDER_SOURCE[input.workItem.source.provider] ?? "API";
  return "API";
}

/** The API state of a run. `blockedOnGate` marks a running run that waits on a person. */
export function runState(run: Pick<Run, "status">, blockedOnGate = false): RunState {
  switch (run.status) {
    case "queued":
      return "QUEUED";
    case "claimed":
      return "CLAIMED";
    case "running":
      return blockedOnGate ? "BLOCKED" : "INPROGRESS";
    case "paused":
    case "blocked":
      return "BLOCKED";
    case "succeeded":
      return "SUCCEEDED";
    case "failed":
      return "FAILED";
    case "error":
      return "ERROR";
    case "cancelled":
      return "CANCELLED";
  }
}

/** The coarse filter used by run lists: running, failed, blocked, cancelled or complete. */
export function taskStatusOf(state: RunState): "running" | "failed" | "blocked" | "cancelled" | "complete" {
  if (state === "SUCCEEDED") return "complete";
  if (state === "FAILED" || state === "ERROR") return "failed";
  if (state === "BLOCKED") return "blocked";
  if (state === "CANCELLED") return "cancelled";
  return "running";
}

export const TERMINAL: Run["status"][] = ["succeeded", "failed", "error", "cancelled"];
export const isTerminal = (r: Pick<Run, "status">) => TERMINAL.includes(r.status);

/** Kiln's work item states mapped onto the six task stages. A stage set through the API wins until the next state change. */
export function taskStage(wi: Pick<WorkItem, "state" | "stage" | "stageOverride">): TaskStage {
  if (wi.state === "complete") return "COMPLETE";
  if (wi.state === "cancelled" || wi.state === "failed") return "CANCELLED";
  if (wi.stageOverride) return wi.stageOverride;
  switch (wi.state) {
    case "received":
    case "triaging":
      return "TRIAGE";
    case "planning":
    case "awaiting_spec":
      return "SPEC";
    case "building":
    case "awaiting_preview":
      return "IMPLEMENT";
    case "reviewing":
    case "handed_off":
      return "REVIEW";
    case "blocked": {
      const s = wi.stage ?? "";
      if (/triage/.test(s)) return "TRIAGE";
      if (/spec|plan/.test(s)) return "SPEC";
      if (/review|handoff|preview/.test(s)) return "REVIEW";
      return s ? "IMPLEMENT" : "TRIAGE";
    }
  }
}

/** Metadata rules: at most 20 keys, keys 1–64 of [a-zA-Z0-9._-], values up to 256 bytes. */
export function checkMetadata(meta: Record<string, string> | undefined): string | undefined {
  if (!meta) return undefined;
  const keys = Object.keys(meta);
  if (keys.length > 20) return "metadata takes at most 20 keys";
  for (const k of keys) {
    if (!/^[a-zA-Z0-9._-]{1,64}$/.test(k)) return `metadata key ${k} must be 1–64 characters of letters, digits, dots, dashes and underscores`;
    if (typeof meta[k] !== "string" || Buffer.byteLength(meta[k]!) > 256) return `metadata value for ${k} must be a string of at most 256 bytes`;
  }
  return undefined;
}

/** Opaque offset cursors for list endpoints. */
export const encodeCursor = (offset: number) => Buffer.from(`o:${offset}`).toString("base64url");
export function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  const m = /^o:(\d+)$/.exec(Buffer.from(cursor, "base64url").toString());
  return m ? Number(m[1]) : 0;
}
export function page<T>(rows: T[], limit: number, cursor?: string): { items: T[]; pageInfo: { hasNextPage: boolean; nextCursor?: string } } {
  const start = decodeCursor(cursor);
  const items = rows.slice(start, start + limit);
  const hasNextPage = start + limit < rows.length;
  return { items, pageInfo: { hasNextPage, ...(hasNextPage ? { nextCursor: encodeCursor(start + limit) } : {}) } };
}
