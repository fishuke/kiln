import { KilnError } from "./errors";
import type { Kiln } from "./kiln";
import { page, runState, taskStage } from "./run-state";
import { TRANSITIONS, isActive } from "./state";
import type { Attachment, Run, RunMode, Source, TaskStage, WorkItem } from "./types";

export type TaskOutput = {
  type: "PLAN" | "PULL_REQUEST" | "SCREENSHOT" | "FILE" | "EXTERNAL_REFERENCE";
  url: string;
  title?: string;
  branch?: string;
  referenceType?: string;
  runId?: string;
  at: string;
};

export type TaskView = {
  id: string;
  factory: string;
  conversationId: string;
  /** The first run of the task (its root), when one has started. */
  runId?: string;
  author: string;
  title: string;
  description: string;
  ticketSource?: string;
  ticketId?: string;
  ticketUrl?: string;
  stage: TaskStage;
  /** Kiln's own state, finer than the stage. */
  state: WorkItem["state"];
  mode?: RunMode;
  branch?: string;
  createdAt: string;
  updatedAt: string;
  outputs: TaskOutput[];
  currentRun?: { id: string; agent: string; state: string; startedAt: string };
  configSource: { sha: string };
};

export type TaskFilter = {
  factory?: string;
  stage?: TaskStage[];
  createdBy?: string[];
  q?: string;
  createdAfter?: string;
  createdBefore?: string;
  updatedAfter?: string;
  updatedBefore?: string;
  sortBy?: "created_at" | "updated_at";
  sortOrder?: "asc" | "desc";
  limit?: number;
  cursor?: string;
  includeCurrentRun?: boolean;
  visible?: (factory: string) => boolean;
};

const TICKET_PROVIDERS: Record<string, Source["provider"]> = { linear: "linear", jira: "jira", github: "github", gitlab: "gitlab", slack: "slack", teams: "teams", discord: "discord" };

/** "linear:PAY-123" → source and tracker key. Unknown prefixes stay as an API source with the reference. */
export function parseTicketRef(ref: string | undefined, url?: string): { source: Source; trackerKey?: string } {
  if (!ref) return { source: { provider: "api", ...(url ? { url } : {}) } };
  const m = /^([a-z][a-z0-9_-]*):(.+)$/i.exec(ref.trim());
  if (!m) throw new KilnError("invalid_request", `ticket_ref must look like <source>:<id>, e.g. linear:PAY-123`);
  const provider = TICKET_PROVIDERS[m[1]!.toLowerCase()];
  const id = m[2]!;
  if (provider === "linear" || provider === "jira") return { source: { provider, issueId: id, ...(url ? { url } : {}) }, trackerKey: id };
  if (provider === "github" || provider === "gitlab") {
    const gh = /^([^/]+\/[^#]+)#(\d+)$/.exec(id);
    return { source: { provider, ...(gh ? { repo: gh[1], number: Number(gh[2]) } : { issueId: id }), ...(url ? { url } : {}) } };
  }
  if (provider) return { source: { provider, thread: id, ...(url ? { url } : {}) } };
  return { source: { provider: "api", issueId: ref, ...(url ? { url } : {}) } };
}

/** Tasks are work items seen through the task API: stages, outputs, soft delete, cancellation of the whole run tree. */
export class TaskService {
  constructor(private readonly k: Kiln) {}

  private require(id: string, factory?: string): WorkItem {
    const wi = this.k.workflow.get(id);
    if (!wi || wi.deletedAt || (factory && wi.factory !== factory)) throw new KilnError("resource_not_found", `unknown task ${id}`);
    return wi;
  }

  runsOf(wi: WorkItem): Run[] {
    return this.k.runs.list({ workItemId: wi.id });
  }

  /** PR, plan, screenshots, files and references, newest first. */
  outputs(wi: WorkItem): TaskOutput[] {
    const out: TaskOutput[] = [];
    const runs = this.runsOf(wi);
    if (wi.spec) {
      const draft = runs.flatMap((r) => r.artifacts.filter((a) => a.kind === "pr" && /draft/.test(a.name)).map(() => r)).at(-1);
      out.push({ type: "PLAN", url: wi.pr?.url ? `${wi.pr.url}/files` : this.k.link(`/runs/${wi.id}`), title: wi.spec.path, at: draft?.finishedAt ?? wi.updatedAt, runId: draft?.id });
    }
    const plan = runs.find((r) => typeof r.result?.plan === "string");
    if (plan) out.push({ type: "PLAN", url: this.k.link(`/agent-runs/${plan.id}`), title: `Plan by ${plan.agent}`, at: plan.finishedAt ?? plan.startedAt, runId: plan.id });
    if (wi.pr) out.push({ type: "PULL_REQUEST", url: wi.pr.url, branch: wi.branch, title: `${wi.pr.repo}#${wi.pr.number}`, at: wi.pr.openedAt ?? wi.updatedAt });
    for (const r of runs) {
      for (const a of r.artifacts) {
        if (a.kind === "pr") continue;
        out.push({ type: a.kind === "image" ? "SCREENSHOT" : "FILE", url: a.url, title: a.name, runId: r.id, at: r.finishedAt ?? r.startedAt });
      }
    }
    if (wi.source.url) out.push({ type: "EXTERNAL_REFERENCE", url: wi.source.url, referenceType: `${wi.source.provider}_${wi.trackerKey ? "issue" : "thread"}`, title: wi.trackerKey ?? wi.title, at: wi.createdAt });
    else if (wi.trackerKey) out.push({ type: "EXTERNAL_REFERENCE", url: wi.trackerKey, referenceType: `${wi.source.provider}_issue`, title: wi.trackerKey, at: wi.createdAt });
    return out.sort((a, b) => b.at.localeCompare(a.at));
  }

  view(wi: WorkItem, opts: { includeCurrentRun?: boolean } = {}): TaskView {
    const runs = this.runsOf(wi);
    const current = runs.find((r) => this.k.runs.isActive(r.id)) ?? runs[0];
    const ticket = wi.trackerKey ?? wi.source.issueId ?? (wi.source.number ? `${wi.source.repo}#${wi.source.number}` : undefined);
    return {
      id: wi.id,
      factory: wi.factory,
      conversationId: wi.conversationId ?? wi.id,
      runId: runs.at(-1)?.id,
      author: wi.requester,
      title: wi.title,
      description: wi.body,
      ...(ticket ? { ticketSource: wi.source.provider, ticketId: ticket } : {}),
      ...(wi.source.url ? { ticketUrl: wi.source.url } : {}),
      stage: taskStage(wi),
      state: wi.state,
      ...(wi.mode ? { mode: wi.mode } : {}),
      ...(wi.branch ? { branch: wi.branch } : {}),
      createdAt: wi.createdAt,
      updatedAt: wi.updatedAt,
      outputs: this.outputs(wi),
      ...(opts.includeCurrentRun && current ? { currentRun: { id: current.id, agent: current.agent, state: runState(current), startedAt: current.startedAt } } : {}),
      configSource: { sha: wi.definitionSha },
    };
  }

  list(filter: TaskFilter = {}) {
    const q = filter.q?.toLowerCase();
    const rows = this.k.workflow
      .list({ factory: filter.factory })
      .filter((w) => !w.deletedAt)
      .filter((w) => !filter.visible || filter.visible(w.factory))
      .filter((w) => !filter.stage?.length || filter.stage.includes(taskStage(w)))
      .filter((w) => !filter.createdBy?.length || filter.createdBy.includes(w.requester))
      .filter((w) => !q || w.title.toLowerCase().includes(q) || w.body.toLowerCase().includes(q))
      .filter((w) => (!filter.createdAfter || w.createdAt >= filter.createdAfter) && (!filter.createdBefore || w.createdAt < filter.createdBefore))
      .filter((w) => (!filter.updatedAfter || w.updatedAt >= filter.updatedAfter) && (!filter.updatedBefore || w.updatedAt < filter.updatedBefore));
    const key = filter.sortBy === "updated_at" ? "updatedAt" : "createdAt";
    const dir = filter.sortOrder === "asc" ? 1 : -1;
    rows.sort((a, b) => dir * a[key].localeCompare(b[key]));
    const { items, pageInfo } = page(rows, Math.min(Math.max(filter.limit ?? 50, 1), 100), filter.cursor);
    return { tasks: items.map((w) => this.view(w, { includeCurrentRun: filter.includeCurrentRun })), pageInfo };
  }

  get(id: string, factory?: string) {
    return this.view(this.require(id, factory), { includeCurrentRun: true });
  }

  /** Create a task for an existing conversation without starting work. One live task per conversation. */
  async create(factory: string, input: { title: string; conversationId: string; description?: string; stage?: TaskStage; by: string }): Promise<TaskView> {
    const live = this.k.workflow.list().find((w) => !w.deletedAt && (w.conversationId ?? w.id) === input.conversationId && isActive(w.state));
    if (live) throw new KilnError("conflict", `conversation ${input.conversationId} already has the live task ${live.id}`);
    const wi = await this.k.workflow.create({ factory, title: input.title, body: input.description ?? "", source: { provider: "api" }, requester: input.by, conversationId: input.conversationId });
    if (input.stage && input.stage !== "TRIAGE") return this.patch(wi.id, { stage: input.stage }, input.by, factory);
    return this.view(this.require(wi.id));
  }

  /** Title, description and stage. Stage writes may move in any direction; COMPLETE and CANCELLED close the task. */
  async patch(id: string, input: { title?: string; description?: string; stage?: TaskStage }, by: string, factory?: string): Promise<TaskView> {
    const wi = this.require(id, factory);
    if (input.title !== undefined || input.description !== undefined) {
      this.k.workflow.update(wi.id, (w) => {
        if (input.title !== undefined) w.title = input.title.slice(0, 200);
        if (input.description !== undefined) w.body = input.description;
      });
    }
    if (input.stage && input.stage !== taskStage(this.require(id))) {
      const current = this.require(id);
      if (input.stage === "CANCELLED") await this.cancel(id, by);
      else if (input.stage === "COMPLETE") {
        if (!isActive(current.state)) throw new KilnError("conflict", `task ${id} is ${current.state}`);
        if (!TRANSITIONS[current.state].includes("handed_off") && current.state !== "handed_off") this.k.workflow.park(id, `completed by ${by}`);
        await this.k.workflow.complete(id, { by: "human", ref: by });
      } else {
        if (!isActive(current.state)) throw new KilnError("conflict", `task ${id} is ${current.state}; it cannot move to ${input.stage}`);
        this.k.workflow.update(id, (w) => {
          w.stageOverride = input.stage;
        });
        this.k.workflow.touch(id, by, `moved the task to ${input.stage}`);
      }
    }
    this.k.audit(by, "task.updated", id, input);
    return this.view(this.require(id));
  }

  /** Soft delete: the task disappears from lists and lookups; runs and history stay. */
  async remove(id: string, by: string, factory?: string) {
    const wi = this.require(id, factory);
    if (isActive(wi.state)) await this.cancel(id, by);
    this.k.workflow.update(id, (w) => {
      w.deletedAt = this.k.clock.now().toISOString();
      w.deletedBy = by;
    });
    this.k.audit(by, "task.deleted", id);
  }

  /** Cancel the task and every run of it (and their subagents) that is still going. */
  async cancel(id: string, by: string, factory?: string): Promise<TaskView> {
    const wi = this.require(id, factory);
    const cancelled: string[] = [];
    for (const r of this.runsOf(wi)) cancelled.push(...(await this.k.runs.cancelTree(r.id, by)));
    await this.k.workflow.cancel(id, by);
    this.k.audit(by, "task.cancelled", id, { runs: cancelled });
    return this.view(this.require(id));
  }

  byRun(runId: string): TaskView | undefined {
    let run = this.k.runs.get(runId);
    for (let i = 0; run && !run.workItemId && run.parentRunId && i < 10; i++) run = this.k.runs.get(run.parentRunId);
    const wi = run?.workItemId ? this.k.workflow.get(run.workItemId) : undefined;
    return wi && !wi.deletedAt ? this.view(wi, { includeCurrentRun: true }) : undefined;
  }

  byConversation(conversationId: string): TaskView | undefined {
    const wi = this.k.workflow.list().find((w) => !w.deletedAt && (w.conversationId ?? w.id) === conversationId);
    return wi ? this.view(wi, { includeCurrentRun: true }) : undefined;
  }

  /** Find a task by id, PR URL, issue URL or key, branch, run id or a link to Kiln. */
  find(reference: string): WorkItem | undefined {
    const ref = reference.trim();
    const id = /(wi_[a-z0-9]+)/i.exec(ref)?.[1];
    if (id) return this.k.workflow.get(id);
    const run = /(run_[a-z0-9]+)/i.exec(ref)?.[1];
    if (run) {
      const t = this.byRun(run);
      return t ? this.k.workflow.get(t.id) : undefined;
    }
    return this.k.workflow
      .list()
      .find((w) => !w.deletedAt && (w.pr?.url === ref || w.source.url === ref || w.trackerKey === ref || w.branch === ref || (w.pr && ref.endsWith(`/${w.pr.repo}/pull/${w.pr.number}`))));
  }

  /** Factory dispatch: a prompt to the foreman, with an optional ticket reference and branch. */
  async dispatch(
    factory: string,
    input: { prompt: string; title?: string; ticketRef?: string; ticketUrl?: string; branch?: string; mode?: RunMode; attachments?: Attachment[]; by: string; via?: Source["provider"]; pipeline?: string; budgetUsd?: number },
  ) {
    const resolved = this.k.defs.current(factory);
    const foreman = Object.values(resolved.agents).find((a) => a.agentType === "FOREMAN")?.name;
    const { source, trackerKey } = parseTicketRef(input.ticketRef, input.ticketUrl);
    if (!input.ticketRef && input.via) source.provider = input.via;
    const title = (input.title ?? input.prompt.split("\n").find((l) => l.trim()) ?? "Task").replace(/^#+\s*/, "").slice(0, 200);
    const wi = await this.k.workflow.create({
      factory,
      title,
      body: input.title ? input.prompt : input.prompt.split("\n").slice(1).join("\n").trim() || input.prompt,
      source,
      requester: input.by,
      trackerKey,
      attachments: input.attachments,
      mode: input.mode,
      branch: input.branch,
      pipeline: input.pipeline,
      budgetUsd: input.budgetUsd,
    });
    void this.k.workflow.advance(wi.id);
    const deadline = Date.now() + 1500;
    let run = this.runsOf(wi).at(-1);
    while (!run && Date.now() < deadline && isActive(this.k.workflow.get(wi.id)?.state ?? "complete")) {
      await new Promise((r) => setTimeout(r, 25));
      run = this.runsOf(wi).at(-1);
    }
    return {
      taskId: wi.id,
      runId: run?.id,
      runUrl: this.k.link(`/runs/${wi.id}`),
      state: run ? runState(run) : "QUEUED",
      factory,
      foremanAgent: foreman,
      ticketRef: input.ticketRef,
      configSource: { sha: wi.definitionSha },
    };
  }
}
