import { KilnError } from "./errors";
import type { Kiln } from "./kiln";
import { isTerminal, page, runState, sourceFor, taskStatusOf } from "./run-state";
import { C, type Run, type RunEvent, type RunSource, type RunState } from "./types";

export type RunView = Run & {
  state: RunState;
  taskStatus: ReturnType<typeof taskStatusOf>;
  source: RunSource;
  rootRunId: string;
  taskId?: string;
  updatedAt: string;
  runTimeMs?: number;
  executionLocation: "KILN" | "SELF_HOSTED";
  isSandboxRunning: boolean;
  isCancellable: boolean;
  children: number;
};

export type RunFilter = {
  state?: RunState[];
  taskStatus?: string[];
  source?: string[];
  factory?: string[];
  agent?: string;
  model?: string;
  kind?: Run["kind"];
  workItemId?: string;
  ancestorRunId?: string;
  artifactType?: string;
  q?: string;
  creator?: string;
  executor?: string;
  createdAfter?: string;
  createdBefore?: string;
  updatedAfter?: string;
  metadata?: Record<string, string>;
  sortBy?: "created_at" | "updated_at" | "title" | "agent";
  sortOrder?: "asc" | "desc";
  limit?: number;
  cursor?: string;
  visible?: (run: Run) => boolean;
};

export type TimelineEntry = { at: string; type: string; text?: string; runId: string; agent: string; data?: unknown };
export type ConversationMessage = { at: string; role: "system" | "user" | "assistant" | "tool"; text: string; runId: string; type: string; data?: unknown };

const ARTIFACT_TYPES: Record<string, string[]> = { SCREENSHOT: ["image"], FILE: ["file", "video", "report"], PULL_REQUEST: ["pr"], PREVIEW: ["preview"], VIDEO: ["video"] };

/** Read side of runs for the API: views with API states, filters, timeline, conversation and transcript. */
export class RunQuery {
  constructor(private readonly k: Kiln) {}

  private blocked(run: Run): boolean {
    return run.status === "running" && this.k.gates.list({ state: "open" }).some((g) => g.runId === run.id);
  }

  view(run: Run, all?: Run[]): RunView {
    const state = runState(run, this.blocked(run));
    const events = this.k.runs.events(run.id);
    const updatedAt = run.finishedAt ?? events.at(-1)?.at ?? run.startedAt;
    const children = (all ?? this.k.store.list<Run>(C.runs)).filter((r) => r.parentRunId === run.id).length;
    return {
      ...run,
      state,
      taskStatus: taskStatusOf(state),
      source: run.source ?? sourceFor({ kind: run.kind, parentRunId: run.parentRunId, workItem: run.workItemId ? this.k.workflow.get(run.workItemId) : undefined }),
      rootRunId: run.rootRunId ?? run.id,
      ...(run.workItemId ? { taskId: run.workItemId } : {}),
      updatedAt,
      ...(run.finishedAt ? { runTimeMs: new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime() } : {}),
      executionLocation: run.workerHost ? "SELF_HOSTED" : "KILN",
      isSandboxRunning: this.k.runs.isActive(run.id),
      isCancellable: !isTerminal(run),
      children,
    };
  }

  require(id: string): Run {
    const run = this.k.runs.get(id);
    if (!run) throw new KilnError("resource_not_found", `unknown run ${id}`);
    return run;
  }

  list(filter: RunFilter = {}) {
    const all = this.k.store.list<Run>(C.runs);
    const ancestors = filter.ancestorRunId ? new Set(this.k.runs.descendants(filter.ancestorRunId).map((r) => r.id)) : undefined;
    const q = filter.q?.toLowerCase();
    const artifactKinds = filter.artifactType ? (ARTIFACT_TYPES[filter.artifactType.toUpperCase()] ?? [filter.artifactType.toLowerCase()]) : undefined;
    const rows = all
      .filter((r) => !filter.visible || filter.visible(r))
      .filter((r) => !filter.factory?.length || filter.factory.includes(r.factory))
      .filter((r) => !filter.agent || r.agent === filter.agent)
      .filter((r) => !filter.model || r.model === filter.model)
      .filter((r) => !filter.kind || r.kind === filter.kind)
      .filter((r) => !filter.workItemId || r.workItemId === filter.workItemId)
      .filter((r) => !ancestors || ancestors.has(r.id))
      .filter((r) => !artifactKinds || r.artifacts.some((a) => artifactKinds.includes(a.kind)))
      .filter((r) => !filter.creator || r.creator === filter.creator)
      .filter((r) => !filter.executor || r.executor === filter.executor)
      .filter((r) => (!filter.createdAfter || r.startedAt >= filter.createdAfter) && (!filter.createdBefore || r.startedAt < filter.createdBefore))
      .filter((r) => !filter.metadata || Object.entries(filter.metadata).every(([k, v]) => r.metadata?.[k] === v))
      .filter((r) => !q || (r.title ?? "").toLowerCase().includes(q) || r.startState.prompt.toLowerCase().includes(q) || (r.summary ?? "").toLowerCase().includes(q))
      .map((r) => this.view(r, all))
      .filter((v) => !filter.state?.length || filter.state.includes(v.state))
      .filter((v) => !filter.taskStatus?.length || filter.taskStatus.includes(v.taskStatus))
      .filter((v) => !filter.source?.length || filter.source.includes(v.source))
      .filter((v) => !filter.updatedAfter || v.updatedAt >= filter.updatedAfter);
    const dir = filter.sortOrder === "asc" ? 1 : -1;
    const key = (v: RunView) => (filter.sortBy === "updated_at" ? v.updatedAt : filter.sortBy === "title" ? (v.title ?? "") : filter.sortBy === "agent" ? v.agent : v.startedAt);
    rows.sort((a, b) => dir * key(a).localeCompare(key(b)));
    const { items, pageInfo } = page(rows, Math.min(Math.max(filter.limit ?? 20, 1), 500), filter.cursor);
    return { runs: items, pageInfo };
  }

  /** Lifecycle, events and subagent starts and finishes in time order. */
  timeline(runId: string): TimelineEntry[] {
    const run = this.require(runId);
    const out: TimelineEntry[] = [{ at: run.queuedAt ?? run.startedAt, type: "created", text: run.title, runId: run.id, agent: run.agent }];
    for (const e of this.k.runs.events(run.id)) out.push({ at: e.at, type: e.type, text: e.text, runId: run.id, agent: run.agent, ...(e.data !== undefined ? { data: e.data } : {}) });
    for (const child of this.k.runs.descendants(run.id)) {
      out.push({ at: child.startedAt, type: "subagent.started", text: `${child.agent}: ${child.title ?? ""}`, runId: child.id, agent: child.agent });
      if (child.finishedAt) out.push({ at: child.finishedAt, type: "subagent.finished", text: `${child.agent}: ${child.status}`, runId: child.id, agent: child.agent });
    }
    return out.sort((a, b) => a.at.localeCompare(b.at));
  }

  /** The run as a normalized conversation: the brief, the agent's messages, tool calls and results, steering. */
  conversation(runId: string): { runId: string; messages: ConversationMessage[] } {
    const run = this.require(runId);
    const messages: ConversationMessage[] = [
      { at: run.startedAt, role: "system", text: run.startState.instructions, runId, type: "instructions" },
      { at: run.startedAt, role: "user", text: run.startState.prompt, runId, type: "prompt" },
    ];
    for (const e of this.k.runs.events(runId)) {
      const m = this.message(e);
      if (m) messages.push(m);
    }
    return { runId, messages };
  }

  private message(e: RunEvent): ConversationMessage | undefined {
    const base = { at: e.at, runId: e.runId, type: e.type };
    if (e.type === "message") return { ...base, role: "assistant", text: e.text ?? "" };
    if (e.type === "steer") return { ...base, role: "user", text: e.text ?? "" };
    if (e.type === "tool_call") return { ...base, role: "assistant", text: `${e.text ?? "tool"}(${e.data === undefined ? "" : JSON.stringify(e.data).slice(0, 2000)})`, data: e.data };
    if (e.type === "tool_result") return { ...base, role: "tool", text: e.text ?? "", data: e.data };
    if (e.type === "error") return { ...base, role: "system", text: `error: ${e.text ?? ""}` };
    return undefined;
  }

  /** Plain-text transcript of the run, for scorers, exports and support. */
  transcript(runId: string): string {
    const run = this.require(runId);
    const lines = [`# Run ${run.id} — ${run.agent} (${run.harness}${run.model ? `, ${run.model}` : ""})`, `Status: ${run.status}`, "", "## Instructions", run.startState.instructions, "", "## Prompt", run.startState.prompt, "", "## Events"];
    for (const e of this.k.runs.events(runId)) lines.push(`[${e.at}] ${e.type}${e.text ? `: ${e.text}` : ""}`);
    if (run.summary) lines.push("", "## Summary", run.summary);
    return `${lines.join("\n")}\n`;
  }

  /** The run that produced or belongs to an external URL: a PR, an issue, a thread or a Kiln link. */
  byExternalReference(url: string): Run | undefined {
    const runId = /(run_[a-z0-9]+)/i.exec(url)?.[1];
    if (runId) return this.k.runs.get(runId);
    const all = this.k.runs.list();
    const withArtifact = all.find((r) => r.artifacts.some((a) => a.url === url));
    if (withArtifact) return withArtifact;
    const wi = this.k.tasks.find(url);
    if (!wi) return undefined;
    const runs = this.k.runs.list({ workItemId: wi.id });
    return runs.at(-1);
  }
}
