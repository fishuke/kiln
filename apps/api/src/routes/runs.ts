import { errorCatalog, KilnError, newId, type Run } from "@kiln/engine";
import type { Context } from "hono";
import { z } from "zod";
import type { Env, RouteContext } from "../app";
import { HttpError } from "../app";
import { resolveRunRef } from "../run-auth";
import type { Route } from "../openapi";
import { Attachments, RunMode } from "../schemas";

const Metadata = z.record(z.string().regex(/^[a-zA-Z0-9._-]{1,64}$/), z.string().max(256)).refine((m) => Object.keys(m).length <= 20, "metadata takes at most 20 keys");

export const Followup = z.object({ message: z.string().min(1), attachments: Attachments.optional(), mode: RunMode.optional() });
export const SpawnAgent = z.object({
  agent: z.string().min(1),
  prompt: z.string().min(1),
  title: z.string().max(200).optional(),
  mode: RunMode.optional(),
  attachments: Attachments.optional(),
  metadata: Metadata.optional(),
  /** Wait for the subagent to finish (default false: return as soon as it starts). */
  wait: z.boolean().optional(),
  /** Unique in the run tree; run tokens can use it in place of the run id. */
  name: z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/, "lowercase letters, digits and dashes, at most 40").optional(),
  /** Start with the parent's conversation so far instead of only the prompt. */
  fork: z.boolean().optional(),
  /** Report to the parent (as a follow-up) when the child finishes or asks a question. */
  report: z.boolean().optional(),
});
export const RunAgents = z.object({ runs: z.array(SpawnAgent.omit({ wait: true })).min(1).max(10), wait: z.boolean().optional() });
export const Ask = z.object({
  title: z.string().min(1).max(200),
  question: z.string().optional(),
  questions: z
    .array(z.object({ id: z.string().min(1), question: z.string().min(1), type: z.enum(["single_select", "multi_select"]), options: z.array(z.string().min(1)).min(2).max(10), recommendedOptionIndex: z.number().int().min(0).optional() }))
    .max(5)
    .optional(),
});
export const ScoreRun = z.object({ scorers: z.array(z.string().min(1)).min(1).max(100).optional() });
export const Sharing = z.object({ publicAccess: z.enum(["VIEWER", "EDITOR"]).nullable() });
export const DirectRun = z.object({
  factory: z.string(),
  agent: z.string().optional(),
  prompt: z.string().min(1),
  title: z.string().max(200).optional(),
  mode: RunMode.optional(),
  attachments: Attachments.optional(),
  metadata: Metadata.optional(),
  model: z.string().optional(),
  workerHost: z.string().nullable().optional(),
  idleTimeoutMinutes: z.number().int().min(0).max(60).optional(),
  branch: z.string().regex(/^kiln\/[A-Za-z0-9._\/-]+$/).optional(),
  source: z.enum(["API", "CLI", "WEB_APP", "MCP"]).optional(),
});

export const routes: Route[] = [
  { method: "post", path: "/api/v1/agent-runs", summary: "Start a run of one agent directly (no task): prompt, mode, metadata, attachments, model, workerHost", scope: "send", body: DirectRun, tag: "Runs" },
  { method: "get", path: "/api/v1/runs/{id}/timeline", summary: "Lifecycle, events and subagent starts/finishes in time order", scope: "read", tag: "Runs" },
  { method: "get", path: "/api/v1/runs/{id}/conversation", summary: "The run as normalized messages (instructions, prompt, agent, tools, steering)", scope: "read", tag: "Runs" },
  { method: "get", path: "/api/v1/runs/{id}/transcript", summary: "Plain-text transcript", scope: "read", tag: "Runs" },
  { method: "get", path: "/api/v1/runs/{id}/scores", summary: "Every score of the run, with how it was triggered", scope: "read", tag: "Runs" },
  { method: "post", path: "/api/v1/runs/{id}/followups", summary: "Follow-up message (with attachments): steers a live run, continues a finished one", scope: "send", body: Followup, tag: "Runs" },
  { method: "post", path: "/api/v1/runs/{id}/score", summary: "Score the run now with the scorers that cover its agent (or `scorers`); re-scoring replaces", scope: "send", body: ScoreRun, tag: "Runs" },
  { method: "post", path: "/api/v1/runs/{id}/interrupt", summary: "Stop what the agent is doing; the run waits (BLOCKED) for a follow-up", scope: "send", tag: "Runs" },
  { method: "post", path: "/api/v1/runs/{id}/spawn", summary: "Start a subagent (run token of this run, or send scope); spawnableBy decides who may start whom", scope: "send", body: SpawnAgent, tag: "Runs" },
  { method: "post", path: "/api/v1/runs/{id}/run-agents", summary: "Start several subagents at once", scope: "send", body: RunAgents, tag: "Runs" },
  { method: "post", path: "/api/v1/runs/{id}/questions", summary: "Ask the requester (single or multi select, recommended option); answer arrives on the gate", scope: "send", body: Ask, tag: "Runs" },
  { method: "put", path: "/api/v1/runs/{id}/sharing", summary: "Share the run with signed-in people as VIEWER or EDITOR (null stops sharing)", scope: "send", body: Sharing, tag: "Runs" },
  { method: "get", path: "/api/v1/run-by-external-reference", summary: "The run behind a PR, issue, thread or Kiln URL (?url=)", scope: "read", tag: "Runs" },
  { method: "get", path: "/api/v1/errors", summary: "Error catalog: codes, HTTP status, retryable, FAILED vs ERROR", tag: "Runs" },
];

/** Run operations beyond the core routes in app.ts. */
export function register({ app, kiln, need, who, canReadRun, canSendRun }: RouteContext) {
  const readable = (c: Context<Env>, id: string): Run => {
    const run = kiln.runs.get(id);
    if (!run) throw new HttpError(404, "unknown run");
    if (!canReadRun(c, run)) throw new HttpError(403, `token lacks read on ${run.factory}`);
    return run;
  };
  const sendable = (c: Context<Env>, id: string): Run => {
    const run = resolveRunRef(kiln, c.get("run"), id);
    if (!run) throw new HttpError(404, "unknown run");
    if (!canSendRun(c, run)) throw new HttpError(403, `token lacks send on ${run.factory}`);
    return run;
  };

  app.get("/api/v1/errors", (c) => c.json(errorCatalog()));

  app.post("/api/v1/agent-runs", async (c) => {
    const body = DirectRun.parse(await c.req.json());
    need(c, "send", body.factory);
    const resolved = kiln.defs.current(body.factory);
    const agent = body.agent ?? Object.values(resolved.agents).find((a) => a.agentType === "FOREMAN")?.name;
    if (!agent || !resolved.agents[agent]) throw new KilnError("resource_not_found", `factory ${body.factory} has no agent ${body.agent ?? "foreman"}`);
    const attachments = body.attachments?.length ? kiln.files.resolveAttachments(body.attachments, who(c), body.factory) : undefined;
    const run = await kiln.runs.startInBackground({
      factory: body.factory,
      sha: kiln.defs.shaFor(body.factory, newId("adhoc")),
      agent,
      prompt: body.prompt,
      title: body.title,
      mode: body.mode,
      attachments,
      metadata: body.metadata,
      creator: who(c),
      source: body.source ?? "API",
      branch: body.branch,
      push: Boolean(body.branch),
      idleTimeoutMinutes: body.idleTimeoutMinutes,
      overrides: { model: body.model, workerHost: body.workerHost },
    });
    return c.json(kiln.runQuery.view(run), 201);
  });

  app.get("/api/v1/runs/:id/timeline", (c) => c.json({ entries: kiln.runQuery.timeline(readable(c, c.req.param("id")).id) }));
  app.get("/api/v1/runs/:id/conversation", (c) => c.json(kiln.runQuery.conversation(readable(c, c.req.param("id")).id)));
  app.get("/api/v1/runs/:id/transcript", (c) => c.text(kiln.runQuery.transcript(readable(c, c.req.param("id")).id)));
  app.get("/api/v1/runs/:id/scores", (c) => c.json({ scores: kiln.scorers.runScores(readable(c, c.req.param("id")).id) }));

  app.post("/api/v1/runs/:id/followups", async (c) => {
    const run = sendable(c, c.req.param("id"));
    const body = Followup.parse(await c.req.json());
    const attachments = body.attachments?.length ? kiln.files.resolveAttachments(body.attachments, who(c), run.factory) : undefined;
    const r = await kiln.runs.followup(run.id, { message: body.message, attachments, by: who(c), mode: body.mode });
    return c.json({ delivered: r.delivered, run: kiln.runQuery.view(r.run) }, r.delivered === "continued" ? 201 : 200);
  });

  // "Score this run" from the run page: the scorers that cover its agent, or the ones named.
  app.post("/api/v1/runs/:id/score", async (c) => {
    const run = sendable(c, c.req.param("id"));
    if (c.get("run")) throw new HttpError(403, "run tokens cannot score runs");
    const { scorers } = ScoreRun.parse(await c.req.json().catch(() => ({})));
    const covering = Object.entries(kiln.defs.current(run.factory).parsed.scorers)
      .filter(([, s]) => s.frontmatter.kind !== "benchmark_task_correctness" && s.frontmatter.agents.some((a) => (typeof a === "string" ? a : a.name) === run.agent))
      .map(([slug]) => slug);
    const slugs = scorers ?? covering;
    if (!slugs.length) throw new HttpError(400, `no scorer covers ${run.agent}; pass scorers`);
    return c.json({ results: await kiln.scorers.dispatch(run.factory, [run.id], slugs, who(c)), scores: kiln.scorers.runScores(run.id) });
  });

  app.post("/api/v1/runs/:id/interrupt", async (c) => {
    const run = sendable(c, c.req.param("id"));
    await kiln.runs.interrupt(run.id, who(c));
    return c.json({ ok: true });
  });

  // Subagents. A run token may spawn only from its own run; people need send on the factory.
  const spawnFrom = (c: Context<Env>, id: string) => {
    const principal = c.get("run");
    if (principal && principal.runId !== id) throw new HttpError(403, "a run token can only spawn subagents of its own run");
    return sendable(c, id);
  };
  const spawnOne = async (c: Context<Env>, parent: Run, s: z.infer<typeof SpawnAgent>) => {
    const attachments = s.attachments?.length ? kiln.files.resolveAttachments(s.attachments, who(c), parent.factory) : undefined;
    const child = await kiln.runs.spawn(parent.id, {
      agent: s.agent,
      prompt: s.prompt,
      title: s.title,
      mode: s.mode,
      metadata: s.metadata,
      attachments,
      wait: s.wait ?? false,
      creator: who(c),
      name: s.name,
      fork: s.fork,
      report: s.report,
    });
    return kiln.runQuery.view(child);
  };

  app.post("/api/v1/runs/:id/spawn", async (c) => {
    const parent = spawnFrom(c, c.req.param("id"));
    const body = SpawnAgent.parse(await c.req.json());
    return c.json(await spawnOne(c, parent, body), 201);
  });

  app.post("/api/v1/runs/:id/run-agents", async (c) => {
    const parent = spawnFrom(c, c.req.param("id"));
    const body = RunAgents.parse(await c.req.json());
    const runs = await Promise.all(body.runs.map((s) => spawnOne(c, parent, { ...s, wait: body.wait })));
    return c.json({ runs }, 201);
  });

  app.post("/api/v1/runs/:id/questions", async (c) => {
    const run = sendable(c, c.req.param("id"));
    const body = Ask.parse(await c.req.json());
    const wi = run.workItemId ? kiln.workflow.get(run.workItemId) : undefined;
    for (const q of body.questions ?? []) if (q.recommendedOptionIndex !== undefined && q.recommendedOptionIndex >= q.options.length) throw new HttpError(400, `recommendedOptionIndex of ${q.id} is out of range`);
    const workItem = wi ?? ({ id: `run:${run.id}`, factory: run.factory, requester: run.creator ?? "kiln", source: { provider: "kiln" } } as never);
    const gate = await kiln.gates.open({
      workItem,
      kind: "question",
      name: `question-${run.id}`,
      title: body.title,
      question: body.question ?? body.questions?.map((q) => `${q.question}\n${q.options.map((o, i) => `${i + 1}. ${o}${q.recommendedOptionIndex === i ? " (recommended)" : ""}`).join("\n")}`).join("\n\n"),
      questions: body.questions,
      runId: run.id,
      assignees: wi ? [wi.requester] : run.creator && !run.creator.includes(":") ? [run.creator] : undefined,
    });
    if (gate.question) await kiln.runs.reportQuestion(run.id, gate.question);
    return c.json(gate, 201);
  });

  app.put("/api/v1/runs/:id/sharing", async (c) => {
    if (c.get("run")) throw new HttpError(403, "run tokens cannot share runs");
    const run = readable(c, c.req.param("id"));
    need(c, "send", run.factory);
    const { publicAccess } = Sharing.parse(await c.req.json());
    return c.json(kiln.runQuery.view(kiln.runs.share(run.id, publicAccess, who(c))));
  });

  app.get("/api/v1/run-by-external-reference", (c) => {
    const url = c.req.query("url");
    if (!url) throw new HttpError(400, "url is required");
    const run = kiln.runQuery.byExternalReference(url);
    if (!run || !canReadRun(c, run)) throw new HttpError(404, `no run for ${url}`);
    return c.json(kiln.runQuery.view(run));
  });
}
