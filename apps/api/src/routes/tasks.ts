import { KilnError, type TaskStage } from "@kiln/engine";
import { z } from "zod";
import type { RouteContext } from "../app";
import { HttpError } from "../app";
import type { Route } from "../openapi";
import { Attachments, RunMode } from "../schemas";
import { flag, limit, listOf, queryObject } from "./util";

const Stage = z.enum(["TRIAGE", "SPEC", "IMPLEMENT", "REVIEW", "COMPLETE", "CANCELLED"]);

export const TaskListQuery = z
  .object({
    stage: listOf(Stage),
    created_by: listOf(z.string()),
    q: z.string().optional(),
    created_after: z.string().optional(),
    created_before: z.string().optional(),
    updated_after: z.string().optional(),
    updated_before: z.string().optional(),
    sort_by: z.enum(["created_at", "updated_at"]).optional(),
    sort_order: z.enum(["asc", "desc"]).optional(),
    limit: limit(100),
    cursor: z.string().optional(),
    include_current_run: flag,
    factory: z.string().optional(),
  })
  .passthrough();

export const CreateTask = z.object({ title: z.string().min(1).max(200), conversationId: z.string().min(1), description: z.string().optional(), stage: Stage.optional() });
export const PatchTask = z.object({ title: z.string().min(1).max(200).optional(), description: z.string().optional(), stage: Stage.optional() }).refine((p) => Object.keys(p).length > 0, "nothing to change");
export const Dispatch = z.object({
  prompt: z.string().min(1),
  title: z.string().max(200).optional(),
  ticket_ref: z.string().optional(),
  ticket_url: z.string().url().optional(),
  branch: z.string().regex(/^[A-Za-z0-9._\/-]+$/).optional(),
  mode: RunMode.optional(),
  attachments: Attachments.optional(),
  pipeline: z.string().optional(),
  budgetUsd: z.number().positive().optional(),
});
export const Handback = z.object({ note: z.string().min(1), branch: z.string().optional(), prUrl: z.string().optional() });

export const routes: Route[] = [
  { method: "post", path: "/api/v1/factories/{id}/runs", summary: "Dispatch a prompt to the factory's foreman (optional ticket_ref, ticket_url, branch, mode)", scope: "send", body: Dispatch, tag: "Tasks" },
  { method: "get", path: "/api/v1/factories/{id}/tasks", summary: "List tasks: stage[], created_by[], q, created/updated after/before, sort, cursor, include_current_run", scope: "read", tag: "Tasks" },
  { method: "post", path: "/api/v1/factories/{id}/tasks", summary: "Create a task for a conversation without starting work (one live task per conversation)", scope: "send", body: CreateTask, tag: "Tasks" },
  { method: "get", path: "/api/v1/factories/{id}/tasks/{taskId}", summary: "A task with its stage, outputs and current run", scope: "read", tag: "Tasks" },
  { method: "patch", path: "/api/v1/factories/{id}/tasks/{taskId}", summary: "Change title, description or stage (any direction; COMPLETE and CANCELLED close it)", scope: "send", body: PatchTask, tag: "Tasks" },
  { method: "delete", path: "/api/v1/factories/{id}/tasks/{taskId}", summary: "Soft-delete a task (cancels it first when it is still active)", scope: "send", tag: "Tasks" },
  { method: "post", path: "/api/v1/factories/{id}/tasks/{taskId}/cancel", summary: "Cancel the task and every run and subagent of it that is still going", scope: "send", tag: "Tasks" },
  { method: "post", path: "/api/v1/factories/{id}/tasks/{taskId}/complete", summary: "complete_task: close the task after its PR merged (agents) or as a person's confirmation (decide:merge)", scope: "send", tag: "Tasks" },
  { method: "get", path: "/api/v1/factories/{id}/tasks/{taskId}/outputs", summary: "Task outputs newest first: PLAN, PULL_REQUEST, SCREENSHOT, FILE, EXTERNAL_REFERENCE", scope: "read", tag: "Tasks" },
  { method: "get", path: "/api/v1/factories/{id}/task-by-run", summary: "The task a run (any run in its tree) belongs to (?run_id=)", scope: "read", tag: "Tasks" },
  { method: "get", path: "/api/v1/factories/{id}/task-by-conversation", summary: "The task of a conversation (?conversation_id=)", scope: "read", tag: "Tasks" },
  { method: "get", path: "/api/v1/tasks", summary: "Tasks across the factories you can read (same filters as the factory list, plus factory)", scope: "read", tag: "Tasks" },
  { method: "get", path: "/api/v1/tasks/lookup", summary: "Find a task by id, run, PR or issue URL, tracker key or branch (?reference=, &start_working=true for local commands)", scope: "read", tag: "Tasks" },
  { method: "post", path: "/api/v1/tasks/{taskId}/handback", summary: "Hand a locally worked task back with a note and the pushed branch or PR", scope: "send", body: Handback, tag: "Tasks" },
];

/** Tasks API: work items with stages, outputs, soft delete, tree-wide cancel and dispatch. */
export function register({ app, kiln, need, who, visible }: RouteContext) {
  const factoryOf = (id: string) => {
    kiln.defs.require(id);
    return id;
  };

  app.post("/api/v1/factories/:id/runs", async (c) => {
    const factory = factoryOf(c.req.param("id"));
    need(c, "send", factory);
    const body = Dispatch.parse(await c.req.json());
    const attachments = body.attachments?.length ? kiln.files.resolveAttachments(body.attachments, who(c), factory) : undefined;
    const r = await kiln.tasks.dispatch(factory, { prompt: body.prompt, title: body.title, ticketRef: body.ticket_ref, ticketUrl: body.ticket_url, branch: body.branch, mode: body.mode, attachments, by: who(c), pipeline: body.pipeline, budgetUsd: body.budgetUsd });
    return c.json(r, 201);
  });

  const listQuery = (q: z.infer<typeof TaskListQuery>) => ({
    stage: q.stage as TaskStage[] | undefined,
    createdBy: q.created_by,
    q: q.q,
    createdAfter: q.created_after,
    createdBefore: q.created_before,
    updatedAfter: q.updated_after,
    updatedBefore: q.updated_before,
    sortBy: q.sort_by,
    sortOrder: q.sort_order,
    limit: q.limit,
    cursor: q.cursor,
    includeCurrentRun: q.include_current_run,
  });

  app.get("/api/v1/factories/:id/tasks", (c) => {
    const factory = factoryOf(c.req.param("id"));
    need(c, "read", factory);
    return c.json(kiln.tasks.list({ factory, ...listQuery(TaskListQuery.parse(queryObject(c))) }));
  });

  app.post("/api/v1/factories/:id/tasks", async (c) => {
    const factory = factoryOf(c.req.param("id"));
    need(c, "send", factory);
    const body = CreateTask.parse(await c.req.json());
    return c.json(await kiln.tasks.create(factory, { ...body, by: who(c) }), 201);
  });

  app.get("/api/v1/factories/:id/tasks/:taskId", (c) => {
    const { id, taskId } = c.req.param();
    need(c, "read", id);
    return c.json(kiln.tasks.get(taskId, id));
  });

  app.patch("/api/v1/factories/:id/tasks/:taskId", async (c) => {
    const { id, taskId } = c.req.param();
    need(c, "send", id);
    const body = PatchTask.parse(await c.req.json());
    if (body.stage === "COMPLETE") need(c, "decide:merge", id);
    return c.json(await kiln.tasks.patch(taskId, body, who(c), id));
  });

  app.delete("/api/v1/factories/:id/tasks/:taskId", async (c) => {
    const { id, taskId } = c.req.param();
    need(c, "send", id);
    await kiln.tasks.remove(taskId, who(c), id);
    return c.json({ ok: true, deleted: taskId });
  });

  app.post("/api/v1/factories/:id/tasks/:taskId/cancel", async (c) => {
    const { id, taskId } = c.req.param();
    need(c, "send", id);
    return c.json(await kiln.tasks.cancel(taskId, who(c), id));
  });

  // complete_task: idempotent. An agent may only close a task whose pull request has merged;
  // otherwise it gets back what the task waits for. A person with decide:merge confirms completion.
  app.post("/api/v1/factories/:id/tasks/:taskId/complete", async (c) => {
    const { id, taskId } = c.req.param();
    need(c, "send", id);
    const wi = kiln.workflow.get(taskId);
    if (!wi || wi.factory !== id || wi.deletedAt) throw new HttpError(404, "unknown task");
    if (wi.state === "complete") return c.json({ completed: true, task: kiln.tasks.get(taskId) });
    if (c.get("run")) {
      if (wi.pr) {
        const [owner, name] = wi.pr.repo.split("/");
        const pr = await kiln.forge.getPullRequest({ owner: owner!, name: name! }, wi.pr.number).catch(() => undefined);
        if (pr?.state === "merged") {
          await kiln.workflow.complete(taskId, { by: "merge", ref: `${wi.pr.repo}#${wi.pr.number}${pr.mergedBy ? ` by ${pr.mergedBy}` : ""}` });
          return c.json({ completed: true, task: kiln.tasks.get(taskId) });
        }
      }
      return c.json({ completed: false, reason: "a task completes when its pull request merges or a person confirms it; it stays open until then", task: kiln.tasks.get(taskId) });
    }
    need(c, "decide:merge", id);
    return c.json({ completed: true, task: await kiln.tasks.patch(taskId, { stage: "COMPLETE" }, who(c), id) });
  });

  app.get("/api/v1/factories/:id/tasks/:taskId/outputs", (c) => {
    const { id, taskId } = c.req.param();
    need(c, "read", id);
    return c.json({ outputs: kiln.tasks.get(taskId, id).outputs });
  });

  app.get("/api/v1/factories/:id/task-by-run", (c) => {
    const id = c.req.param("id");
    need(c, "read", id);
    const runId = c.req.query("run_id");
    if (!runId) throw new HttpError(400, "run_id is required");
    const t = kiln.tasks.byRun(runId);
    if (!t || t.factory !== id) throw new HttpError(404, `no task for run ${runId}`);
    return c.json(t);
  });

  app.get("/api/v1/factories/:id/task-by-conversation", (c) => {
    const id = c.req.param("id");
    need(c, "read", id);
    const conv = c.req.query("conversation_id");
    if (!conv) throw new HttpError(400, "conversation_id is required");
    const t = kiln.tasks.byConversation(conv);
    if (!t || t.factory !== id) throw new HttpError(404, `no task for conversation ${conv}`);
    return c.json(t);
  });

  app.get("/api/v1/tasks", (c) => {
    const q = TaskListQuery.parse(queryObject(c));
    if (q.factory) need(c, "read", q.factory);
    return c.json(kiln.tasks.list({ factory: q.factory, ...listQuery(q), visible: (f) => visible(c, f) }));
  });

  app.get("/api/v1/tasks/lookup", async (c) => {
    const reference = c.req.query("reference");
    if (!reference) throw new HttpError(400, "reference is required");
    const wi = kiln.tasks.find(reference);
    if (!wi || wi.deletedAt) throw new HttpError(404, `no task for ${reference}`);
    need(c, "read", wi.factory);
    const task = kiln.tasks.get(wi.id);
    if (c.req.query("start_working") !== "true" && c.req.query("start_working") !== "1") return c.json({ task });
    need(c, "send", wi.factory);
    const repo = kiln.defs.resolved(wi.definitionSha).factory.repositories[0]!;
    const branch = wi.branch ?? `kiln/${wi.id.replace(/^wi_/, "")}`;
    const cloneUrl = kiln.forge.cloneUrl(repo);
    const dir = `../${repo.name}-${wi.id}`;
    kiln.workflow.touch(wi.id, who(c), "picked the task up in a local worktree");
    return c.json({
      task,
      startWorking: {
        repo: `${repo.owner}/${repo.name}`,
        cloneUrl,
        branch,
        brief: `${wi.title}\n\n${wi.body}`,
        commands: [
          `git fetch ${cloneUrl} ${branch} || true`,
          `git worktree add ${dir} -B ${branch} FETCH_HEAD 2>/dev/null || git worktree add ${dir} -b ${branch}`,
          `cd ${dir}`,
          "# work, commit and push the branch, then hand it back with send_task (task_id, branch, note)",
        ],
      },
    });
  });

  app.post("/api/v1/tasks/:taskId/handback", async (c) => {
    const wi = kiln.workflow.get(c.req.param("taskId"));
    if (!wi || wi.deletedAt) throw new KilnError("resource_not_found", "unknown task");
    need(c, "send", wi.factory);
    const body = Handback.parse(await c.req.json());
    kiln.workflow.update(wi.id, (w) => {
      if (body.branch) w.branch = body.branch;
      if (w.pr) w.pr.humanCodeChange = true;
    });
    kiln.workflow.addMessage(wi.id, who(c), `Handed back: ${body.note}${body.prUrl ? `\nPull request: ${body.prUrl}` : ""}${body.branch ? `\nBranch: ${body.branch}` : ""}`);
    void kiln.workflow.advance(wi.id);
    return c.json(kiln.tasks.get(wi.id));
  });
}
