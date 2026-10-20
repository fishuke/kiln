import { can, issueToken, SCOPES, verifyToken, type ApiToken, type Scope } from "@kiln/auth";
import { guardCommand } from "@kiln/decide";
import { KilnError, slug, type Gate, type Kiln, type Run } from "@kiln/engine";
import {
  normalizeGitHub,
  normalizeJira,
  normalizeLinear,
  normalizeSlack,
  verifyGitHub,
  verifyLinear,
  verifySentry,
  verifySlack,
  verifyStandardWebhook,
  verifyStripe,
} from "@kiln/integrations";
import { Hono, type Context } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { openApiDocument } from "./openapi";
import { agentMayCall, inOwnTree, isPublicPath, runTokenAuth, type RunPrincipal } from "./run-auth";
import { registerModules } from "./routes";
import * as S from "./schemas";

export type Env = { Variables: { token: ApiToken; run?: RunPrincipal } };

export class HttpError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409,
    message: string,
  ) {
    super(message);
  }
}

const DEV_TOKEN: ApiToken = { id: "tok_dev", name: "dev", subject: "dev@kiln.local", hash: "", grants: [{ scope: "admin", factory: "*" }], createdAt: new Date(0).toISOString() };

export type AppOptions = {
  /** Every request acts as an admin. Only for local development. */
  devAuth?: boolean;
  /** Mounted at /mcp when given. */
  mcp?: (req: Request) => Promise<Response>;
};

const GATE_SCOPE: Record<Gate["kind"], Scope> = { spec: "decide:spec", preview: "decide:preview", question: "decide:question", merge: "decide:merge", custom: "decide:merge" };

/** What a route module gets: the app, the Kiln container and the auth helpers. */
export type RouteContext = {
  app: Hono<Env>;
  kiln: Kiln;
  options: AppOptions;
  need: (c: Context<Env>, scope: Scope, factory: string | "*") => void;
  who: (c: Context<Env>) => string;
  visible: (c: Context<Env>, factory: string) => boolean;
  /** Read access to a run: the factory, the agent's own tree, or the run's share link. */
  canReadRun: (c: Context<Env>, run: Run) => boolean;
  /** Send access to a run (steer, follow up): the factory, the agent's own tree, or an EDITOR share link. */
  canSendRun: (c: Context<Env>, run: Run) => boolean;
};

export function createApp(kiln: Kiln, options: AppOptions = {}) {
  const app = new Hono<Env>();

  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ error: err.message }, err.status);
    if (err instanceof KilnError) {
      const s = err.spec;
      const status = s.http;
      return c.json({ error: err.message, code: err.code, title: s.title, status, retryable: s.retryable !== false, ...err.details }, status);
    }
    if (err instanceof z.ZodError) return c.json({ error: "invalid request", issues: err.issues.map((i) => `${i.path.join(".")}: ${i.message}`) }, 400);
    const message = err instanceof Error ? err.message : String(err);
    if (/^unknown |not found|has no /.test(message)) return c.json({ error: message }, 404);
    return c.json({ error: message }, 500);
  });

  app.get("/api/v1/health", (c) => c.json({ ok: true, factories: kiln.defs.list().length, time: kiln.clock.now().toISOString() }));
  app.get("/api/v1/openapi.json", (c) => c.json(openApiDocument()));

  // Agents call this from the Claude Code PreToolUse hook with their run token.
  app.post("/api/v1/guard", async (c) => {
    const raw = c.req.header("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
    const claims = kiln.secrets.verify(raw);
    if (!claims) throw new HttpError(401, "a valid run token is required");
    const body = S.Guard.parse(await c.req.json());
    const run = kiln.runs.get(claims.runId);
    const def = run ? kiln.defs.resolved(run.definitionSha).parsed.decisions["command-guard"] : undefined;
    const { verdict, outcome } = await guardCommand(body.command, { cwd: body.cwd }, kiln.decide, def);
    kiln.logDecision(outcome, { command: body.command }, { runId: claims.runId, workItemId: run?.workItemId });
    if (verdict === "ask_human" && run) {
      const ok = await kiln.gates.askCommand({ run, workItem: run.workItemId ? kiln.workflow.get(run.workItemId) : undefined, command: body.command });
      return c.json({ verdict: ok ? "allow" : "block" });
    }
    return c.json({ verdict });
  });

  // ---- webhooks: verified by provider signature, deduplicated by delivery id ----
  app.post("/webhooks/github", async (c) => {
    const body = await c.req.text();
    const secret = serverSecret(kiln, "GITHUB_WEBHOOK_SECRET");
    if (secret && !verifyGitHub(secret, body, c.req.header("x-hub-signature-256"))) throw new HttpError(401, "bad signature");
    const ev = normalizeGitHub(c.req.header("x-github-event") ?? "", JSON.parse(body), c.req.header("x-github-delivery"));
    return c.json(ev ? summarize(await kiln.automations.handle(ev)) : { ignored: true });
  });
  app.post("/webhooks/slack", async (c) => {
    const body = await c.req.text();
    const payload = JSON.parse(body);
    if (payload.type === "url_verification") return c.json({ challenge: payload.challenge });
    const secret = serverSecret(kiln, "SLACK_SIGNING_SECRET");
    if (secret && !verifySlack(secret, body, c.req.header("x-slack-request-timestamp"), c.req.header("x-slack-signature"))) throw new HttpError(401, "bad signature");
    const ev = normalizeSlack(payload);
    // Slack wants an answer within 3 s; work continues in the background.
    if (ev) void kiln.automations.handle(ev);
    return c.json({ ok: true });
  });
  app.post("/webhooks/linear", async (c) => {
    const body = await c.req.text();
    const secret = serverSecret(kiln, "LINEAR_WEBHOOK_SECRET");
    if (secret && !verifyLinear(secret, body, c.req.header("linear-signature"))) throw new HttpError(401, "bad signature");
    const ev = normalizeLinear(JSON.parse(body), c.req.header("linear-delivery"));
    return c.json(ev ? summarize(await kiln.automations.handle(ev)) : { ignored: true });
  });
  app.post("/webhooks/jira", async (c) => {
    const secret = serverSecret(kiln, "JIRA_WEBHOOK_TOKEN");
    if (secret && c.req.query("token") !== secret) throw new HttpError(401, "bad token");
    const ev = normalizeJira(await c.req.json(), c.req.header("x-atlassian-webhook-identifier"));
    return c.json(ev ? summarize(await kiln.automations.handle(ev)) : { ignored: true });
  });
  app.post("/webhooks/:factory/:name", async (c) => {
    const { factory, name } = c.req.param();
    const resolved = kiln.defs.current(factory);
    const hook = resolved.parsed.webhooks[name];
    if (!hook || !hook.enabled) throw new HttpError(404, `unknown webhook ${name}`);
    const body = await c.req.text();
    const secret = kiln.secrets.getSecret(hook.secretName);
    if (!secret) throw new HttpError(401, `secret ${hook.secretName} is not set`);
    const ok =
      hook.authMode === "signature"
        ? hook.signatureScheme === "github"
          ? verifyGitHub(secret, body, c.req.header("x-hub-signature-256"))
          : hook.signatureScheme === "stripe"
            ? verifyStripe(secret, body, c.req.header("stripe-signature"))
            : hook.signatureScheme === "sentry"
              ? verifySentry(secret, body, c.req.header("sentry-hook-signature"))
              : verifyStandardWebhook(secret, c.req.header("webhook-id"), c.req.header("webhook-timestamp"), body, c.req.header("webhook-signature"))
        : hook.authMode === "url_token"
          ? c.req.query("token") === secret
          : c.req.header("authorization") === `Bearer ${secret}`;
    if (!ok) throw new HttpError(401, "webhook authentication failed");
    let payload: unknown = body;
    try {
      payload = JSON.parse(body);
    } catch {
      /* plain text payloads are fine */
    }
    const deliveryId = hook.deliveryIdHeader ? c.req.header(hook.deliveryIdHeader) : undefined;
    const p = payload as Record<string, unknown>;
    const ev = { provider: "webhook" as const, event: "received", deliveryId, data: { webhook: name, title: String(p?.title ?? p?.summary ?? `${name} webhook`), body: typeof payload === "string" ? payload : JSON.stringify(payload, null, 2), payload } };
    return c.json(summarize(await kiln.automations.handle(ev)));
  });

  // ---- MCP (streamable HTTP) ----
  if (options.mcp) app.all("/mcp", (c) => options.mcp!(c.req.raw));

  // ---- authenticated API ----
  app.use("/api/v1/*", async (c, next) => {
    if (isPublicPath(c.req.path)) {
      c.set("token", { id: "anonymous", name: "anonymous", subject: "anonymous", hash: "", grants: [], createdAt: new Date(0).toISOString() });
      return next();
    }
    const raw = c.req.header("authorization")?.replace(/^Bearer\s+/i, "");
    // Agents call with their run token: limited to their own factory, task and run tree.
    const agent = runTokenAuth(kiln, raw);
    if (agent) {
      const denied = agentMayCall(kiln, agent.principal, c.req.method, c.req.path);
      if (denied) throw new HttpError(403, denied);
      c.set("token", agent.token);
      c.set("run", agent.principal);
      return next();
    }
    if (options.devAuth) {
      c.set("token", DEV_TOKEN);
      return next();
    }
    const token = verifyToken(kiln.store, raw, kiln.clock.now());
    if (!token) throw new HttpError(401, "missing or invalid token");
    c.set("token", token);
    return next();
  });

  const need = (c: Context<Env>, scope: Scope, factory: string | "*") => {
    if (!can(c.get("token"), scope, factory)) throw new HttpError(403, `token lacks ${scope} on ${factory}`);
  };
  const who = (c: Context<Env>) => c.get("token").subject;
  const visible = (c: Context<Env>, factory: string) => can(c.get("token"), "read", factory) || can(c.get("token"), "send", factory);
  const canReadRun = (c: Context<Env>, run: Run) => {
    const p = c.get("run");
    if (p) return inOwnTree(kiln, p, run);
    return can(c.get("token"), "read", run.factory) || Boolean(run.sharing?.publicAccess);
  };
  const canSendRun = (c: Context<Env>, run: Run) => {
    const p = c.get("run");
    if (p) return inOwnTree(kiln, p, run);
    return can(c.get("token"), "send", run.factory) || run.sharing?.publicAccess === "EDITOR";
  };
  const mustReadRun = (c: Context<Env>, id: string) => {
    const run = kiln.runs.get(id);
    if (!run) throw new HttpError(404, "unknown run");
    if (!canReadRun(c, run)) throw new HttpError(403, `token lacks read on ${run.factory}`);
    return run;
  };
  const mustSendRun = (c: Context<Env>, id: string) => {
    const run = kiln.runs.get(id);
    if (!run) throw new HttpError(404, "unknown run");
    if (!canSendRun(c, run)) throw new HttpError(403, `token lacks send on ${run.factory}`);
    return run;
  };

  app.get("/api/v1/me", (c) => {
    const t = c.get("token");
    const run = c.get("run");
    return c.json({ subject: t.subject, name: t.name, grants: t.grants, ...(run ? { run } : {}) });
  });

  // factories and definitions
  app.get("/api/v1/factories", (c) =>
    c.json(
      kiln.defs
        .list()
        .filter((f) => visible(c, f.id))
        .map((f) => {
          const r = f.appliedSha ? kiln.defs.resolved(f.appliedSha) : undefined;
          return { ...f, description: r?.factory.description, repositories: r?.factory.repositories ?? [], agents: Object.keys(r?.agents ?? {}).length, openGates: kiln.gates.list({ factory: f.id, state: "open" }).length };
        }),
    ),
  );
  app.get("/api/v1/factories/:id", (c) => {
    const id = c.req.param("id");
    need(c, "read", id);
    const f = kiln.defs.require(id);
    const r = kiln.defs.resolved(f.appliedSha!);
    const p = r.parsed;
    return c.json({
      factory: f,
      definition: r.factory,
      agents: Object.values(r.agents).map(({ instructions, ...a }) => ({ ...a, instructions })),
      automations: Object.values(r.automations),
      pipelines: p.pipelines,
      gates: p.gates,
      policies: p.policies,
      runners: p.runners,
      routers: p.routers,
      scorers: Object.fromEntries(Object.entries(p.scorers).map(([k, v]) => [k, { ...v.frontmatter, rubric: v.rubric }])),
      benchmarks: Object.fromEntries(Object.entries(p.benchmarks).map(([k, v]) => [k, { ...v.suite, taskDetails: v.tasks }])),
      skills: Object.fromEntries(Object.entries(p.skills).map(([k, v]) => [k, { ...v.frontmatter, body: v.body }])),
      decisions: p.decisions,
      memories: Object.fromEntries(Object.entries(p.memories).map(([k, v]) => [k, { ...v.frontmatter, body: v.body }])),
      warnings: p.warnings,
    });
  });
  app.get("/api/v1/factories/:id/definition", (c) => {
    const id = c.req.param("id");
    need(c, "read", id);
    const f = kiln.defs.require(id);
    const sha = c.req.query("sha") ?? f.appliedSha!;
    return c.json({ sha, tree: kiln.defs.tree(sha) ?? {}, canary: f.canary, previousSha: f.previousSha });
  });
  app.post("/api/v1/definitions/validate", async (c) => {
    const { tree } = S.Tree.parse(await c.req.json());
    return c.json(kiln.defs.validate(tree));
  });
  app.post("/api/v1/definitions/diff", async (c) => {
    const { tree, factory } = S.TreeFor.parse(await c.req.json());
    need(c, "read", factory);
    return c.json(kiln.defs.diff(factory, tree));
  });
  app.post("/api/v1/definitions/apply", async (c) => {
    const body = S.Apply.parse(await c.req.json());
    const v = kiln.defs.validate(body.tree);
    const named = v.ok ? kiln.defs.resolveTree(body.tree).factory : undefined;
    const target = body.factory ?? (named ? slug(named.alias ?? named.name) : undefined) ?? "*";
    need(c, "definitions:write", target);
    const r = kiln.defs.applyAny(body.tree, { author: who(c), factory: body.factory, canaryPercent: body.canaryPercent, dryRun: body.dryRun });
    return c.json(r, r.ok ? 200 : 400);
  });
  app.post("/api/v1/factories/connect", async (c) => {
    const body = S.Connect.parse(await c.req.json());
    need(c, "definitions:write", "*");
    const r = await kiln.defs.connectRepo(body, who(c));
    return c.json(r, r.ok ? 200 : 400);
  });
  app.post("/api/v1/factories/:id/sync", async (c) => {
    const id = c.req.param("id");
    need(c, "definitions:write", id);
    return c.json(await kiln.defs.syncFromRepo(id, who(c)));
  });
  app.post("/api/v1/factories/:id/canary/:action", (c) => {
    const { id, action } = c.req.param();
    need(c, "definitions:write", id);
    if (action === "promote") kiln.defs.promoteCanary(id, who(c));
    else if (action === "rollback") kiln.defs.rollbackCanary(id, who(c));
    else throw new HttpError(404, `unknown canary action ${action}`);
    return c.json(kiln.defs.require(id));
  });

  // work items
  app.get("/api/v1/work-items", (c) => {
    const factory = c.req.query("factory");
    const items = kiln.workflow.list({ factory, state: c.req.query("state") as never, projectId: c.req.query("project") }).filter((w) => visible(c, w.factory));
    return c.json(items.map(({ conversation, ...w }) => ({ ...w, messages: conversation.length })));
  });
  app.post("/api/v1/work-items", async (c) => {
    const { attachments: keys, mode, ...body } = S.CreateWorkItem.parse(await c.req.json());
    need(c, "send", body.factory);
    const attachments = keys?.length ? kiln.files.resolveAttachments(keys, who(c), body.factory) : undefined;
    const wi = await kiln.workflow.create({ ...body, attachments, mode, source: { provider: body.via ?? "api" }, requester: who(c) });
    void kiln.workflow.advance(wi.id);
    return c.json(wi, 201);
  });
  app.get("/api/v1/work-items/:id", (c) => {
    const wi = kiln.workflow.get(c.req.param("id"));
    if (!wi) throw new HttpError(404, "unknown work item");
    need(c, "read", wi.factory);
    return c.json({ ...wi, runs: kiln.runs.list({ workItemId: wi.id }), gates: kiln.gates.list({ workItemId: wi.id }), decisions: kiln.store.list("decision_logs", (d: { id: string; workItemId?: string }) => d.workItemId === wi.id) });
  });
  app.post("/api/v1/work-items/:id/messages", async (c) => {
    const wi = kiln.workflow.get(c.req.param("id"));
    if (!wi) throw new HttpError(404, "unknown work item");
    need(c, "send", wi.factory);
    const { text, attachments: keys } = S.Message.parse(await c.req.json());
    const attachments = keys?.length ? kiln.files.resolveAttachments(keys, who(c), wi.factory) : [];
    const open = c.get("run") ? undefined : kiln.gates.list({ workItemId: wi.id, state: "open" }).find((g) => g.kind === "question" && !g.command);
    if (open) {
      if (attachments.length) kiln.workflow.addMessage(wi.id, who(c), `Attached ${attachments.map((a) => a.name).join(", ")}`, attachments);
      await kiln.gates.decide(open.id, { decision: "answer", answer: text, by: who(c), via: "web" });
    } else kiln.workflow.addMessage(wi.id, who(c), text, attachments);
    return c.json(kiln.workflow.get(wi.id));
  });
  app.post("/api/v1/work-items/:id/cancel", async (c) => {
    const wi = kiln.workflow.get(c.req.param("id"));
    if (!wi) throw new HttpError(404, "unknown work item");
    need(c, "send", wi.factory);
    return c.json(await kiln.workflow.cancel(wi.id, who(c)));
  });
  app.post("/api/v1/work-items/:id/complete", async (c) => {
    const wi = kiln.workflow.get(c.req.param("id"));
    if (!wi) throw new HttpError(404, "unknown work item");
    need(c, "decide:merge", wi.factory);
    if (wi.state !== "handed_off") throw new HttpError(409, "only handed-off work can be confirmed complete");
    return c.json(await kiln.workflow.complete(wi.id, { by: "human", ref: who(c) }));
  });
  // Take a task to a local worktree (kiln pull), and give it back (kiln handback).
  app.post("/api/v1/work-items/:id/pull", (c) => {
    const wi = kiln.workflow.get(c.req.param("id"));
    if (!wi) throw new HttpError(404, "unknown work item");
    need(c, "send", wi.factory);
    const repo = kiln.defs.resolved(wi.definitionSha).factory.repositories[0]!;
    kiln.workflow.touch(wi.id, who(c), "took the task to a local worktree");
    return c.json({ workItem: wi, branch: wi.branch ?? `kiln/${wi.id.replace(/^wi_/, "")}`, cloneUrl: kiln.forge.cloneUrl(repo), repo: `${repo.owner}/${repo.name}`, brief: `${wi.title}\n\n${wi.body}` });
  });
  app.post("/api/v1/work-items/:id/handback", async (c) => {
    const wi = kiln.workflow.get(c.req.param("id"));
    if (!wi) throw new HttpError(404, "unknown work item");
    need(c, "send", wi.factory);
    const { text } = S.Message.parse(await c.req.json());
    kiln.workflow.addMessage(wi.id, who(c), `Handed back: ${text}`);
    // Code written by a person in a local worktree: the PR is no longer autonomous.
    kiln.workflow.update(wi.id, (w) => {
      if (w.pr) w.pr.humanCodeChange = true;
    });
    void kiln.workflow.advance(wi.id);
    return c.json(kiln.workflow.get(wi.id));
  });

  // runs
  // Runs: filters, sorting and cursor pages (see RunQuery). Old `factory`/`workItem` params still work.
  app.get("/api/v1/runs", (c) => {
    const q = S.RunListQuery.parse(Object.fromEntries(Object.entries(c.req.queries()).map(([k, v]) => [k, v.length > 1 ? v : v[0]])));
    const metadata = Object.fromEntries(Object.entries(c.req.query()).filter(([k]) => /^metadata\[.+\]$/.test(k)).map(([k, v]) => [k.slice(9, -1), v]));
    if (Object.keys(metadata).length > 5) throw new HttpError(400, "filter on at most 5 metadata keys");
    const principal = c.get("run");
    const mine = q.mine === "true" || q.mine === "1" ? who(c) : undefined;
    return c.json(
      kiln.runQuery.list({
        state: q.state,
        taskStatus: q.task_status,
        source: q.source,
        factory: q.factory_uid ?? (q.factory ? [q.factory] : undefined),
        agent: q.agent ?? q.name,
        model: q.model_id,
        kind: q.kind as Run["kind"] | undefined,
        workItemId: q.workItem ?? q.task_id,
        ancestorRunId: q.ancestor_run_id,
        artifactType: q.artifact_type,
        q: q.q,
        creator: mine ?? q.creator,
        executor: q.executor,
        createdAfter: q.created_after,
        createdBefore: q.created_before,
        updatedAfter: q.updated_after,
        metadata: Object.keys(metadata).length ? metadata : undefined,
        sortBy: q.sort_by,
        sortOrder: q.sort_order,
        limit: q.limit,
        cursor: q.cursor,
        visible: (r) => (principal ? inOwnTree(kiln, principal, r) : visible(c, r.factory) || Boolean(r.sharing?.publicAccess)),
      }),
    );
  });
  app.get("/api/v1/runs/:id", (c) => {
    const run = mustReadRun(c, c.req.param("id"));
    return c.json({ ...kiln.runQuery.view(run), live: kiln.runs.isActive(run.id), scores: kiln.scoring.list({ runId: run.id }) });
  });
  app.get("/api/v1/runs/:id/events", (c) => {
    const run = mustReadRun(c, c.req.param("id"));
    return c.json(kiln.runs.events(run.id, Number(c.req.query("after") ?? 0)));
  });
  app.get("/api/v1/runs/:id/stream", (c) => {
    const run = mustReadRun(c, c.req.param("id"));
    return streamSSE(c, async (stream) => {
      let after = Number(c.req.query("after") ?? 0);
      for (;;) {
        for (const e of kiln.runs.events(run.id, after)) {
          await stream.writeSSE({ id: String(e.seq), event: e.type, data: JSON.stringify(e) });
          after = e.seq;
        }
        const r = kiln.runs.get(run.id);
        if (r && !["running", "queued", "claimed"].includes(r.status) && !kiln.runs.isActive(run.id)) break;
        await stream.sleep(500);
      }
    });
  });
  app.post("/api/v1/runs/:id/steer", async (c) => {
    const run = mustSendRun(c, c.req.param("id"));
    const { text } = S.Message.parse(await c.req.json());
    await kiln.runs.steer(run.id, text, who(c));
    return c.json({ ok: true });
  });
  app.post("/api/v1/runs/:id/:action{replay|cancel|pause|resume}", async (c) => {
    const run = mustSendRun(c, c.req.param("id"));
    const action = c.req.param("action");
    if (c.get("run") && action !== "cancel") throw new HttpError(403, `run tokens cannot ${action} runs`);
    if (action === "replay") {
      const body = S.Replay.parse(await c.req.json().catch(() => ({})));
      return c.json(await kiln.runs.replay(run.id, { sha: body.sha }));
    }
    if (action === "cancel") await kiln.runs.cancel(run.id, who(c));
    if (action === "pause") return c.json(await kiln.runs.pause(run.id, who(c)));
    if (action === "resume") return c.json(await kiln.runs.resume(run.id, who(c)));
    return c.json({ ok: true });
  });
  app.post("/api/v1/runs/:id/save-benchmark", async (c) => {
    const run = kiln.runs.get(c.req.param("id"));
    if (!run) throw new HttpError(404, "unknown run");
    need(c, "definitions:write", run.factory);
    const body = S.SaveBenchmark.parse(await c.req.json());
    return c.json({ files: kiln.benchmarks.saveRunAsTask(run.id, body) });
  });

  // inbox and gates
  app.get("/api/v1/inbox", (c) => {
    const assignee = c.req.query("all") ? undefined : (c.req.query("assignee") ?? (options.devAuth ? undefined : who(c)));
    const gates = kiln.gates.inbox(assignee).filter((g) => visible(c, g.factory));
    const user = who(c);
    return c.json(
      gates.map((g) => {
        const q = g.questions?.[0];
        const s = kiln.inbox.gateState(user, g.id);
        return { ...g, ...(q ? { options: q.options, multiSelect: q.type === "multi_select", recommendedOptionIndex: q.recommendedOptionIndex } : {}), read: s.read, resolved: s.resolved, workItem: summarizeItem(kiln, g.workItemId) };
      }),
    );
  });
  app.get("/api/v1/gates/:id", (c) => {
    const g = kiln.gates.get(c.req.param("id"));
    if (!g) throw new HttpError(404, "unknown gate");
    need(c, "read", g.factory);
    return c.json({ ...g, workItem: kiln.workflow.get(g.workItemId) });
  });
  app.post("/api/v1/gates/:id/decide", async (c) => {
    const g = kiln.gates.get(c.req.param("id"));
    if (!g) throw new HttpError(404, "unknown gate");
    need(c, GATE_SCOPE[g.kind], g.factory);
    const body = S.Decide.parse(await c.req.json());
    return c.json(await kiln.gates.decide(g.id, { ...body, by: who(c), via: body.via ?? "web" }));
  });

  // projects, planning, portfolio
  app.get("/api/v1/projects", (c) => c.json(kiln.planning.projects()));
  app.post("/api/v1/projects", async (c) => {
    const body = S.Project.parse(await c.req.json());
    for (const f of body.factories) need(c, "send", f);
    return c.json(kiln.planning.createProject({ ...body, owner: who(c) }), 201);
  });
  app.get("/api/v1/projects/:id", (c) => {
    const p = kiln.planning.project(c.req.param("id"));
    if (!p) throw new HttpError(404, "unknown project");
    return c.json({ ...p, roadmap: p.roadmapId ? kiln.planning.roadmap(p.roadmapId) : undefined, workItems: kiln.workflow.list({ projectId: p.id }) });
  });
  app.post("/api/v1/projects/:id/plan", async (c) => {
    const p = kiln.planning.project(c.req.param("id"));
    if (!p) throw new HttpError(404, "unknown project");
    for (const f of p.factories) need(c, "send", f);
    const body = S.Plan.parse(await c.req.json());
    return c.json(await kiln.planning.plan(p.id, { ...body, by: who(c) }));
  });
  app.get("/api/v1/portfolio", (c) => c.json(kiln.planning.portfolio(c.req.query("since"))));
  app.get("/api/v1/digest", (c) => {
    const all = kiln.planning.digest();
    return c.json(c.req.query("all") || options.devAuth ? all : all.filter((d) => d.person === who(c)));
  });

  // measure and improve
  app.get("/api/v1/metrics", (c) => {
    const factory = c.req.query("factory");
    if (!factory) return c.json(kiln.defs.list().filter((f) => visible(c, f.id)).map((f) => kiln.metrics.factory(f.id, { since: c.req.query("since") })));
    need(c, "read", factory);
    return c.json(kiln.metrics.factory(factory, { since: c.req.query("since"), agent: c.req.query("agent") }));
  });
  app.get("/api/v1/metrics/raw", (c) => {
    const factory = c.req.query("factory") ?? "";
    need(c, "read", factory);
    return c.json(kiln.metrics.raw(factory, (c.req.query("kind") ?? "runs") as "runs", c.req.query("since")));
  });
  app.get("/api/v1/scores", (c) => {
    const factory = c.req.query("factory") ?? "";
    need(c, "read", factory);
    return c.json(kiln.scoring.list({ factory, agent: c.req.query("agent"), runId: c.req.query("run") }));
  });
  app.get("/api/v1/factories/:id/self-improvement", (c) => {
    const id = c.req.param("id");
    need(c, "read", id);
    return c.json({ proposals: kiln.improvement.list(id), failures: kiln.scoring.failures(id) });
  });
  app.post("/api/v1/factories/:id/self-improvement/run", async (c) => {
    const id = c.req.param("id");
    need(c, "definitions:write", id);
    return c.json(await kiln.improvement.check(id, { runNow: true }));
  });
  app.post("/api/v1/proposals/:id/:action{approve|reject}", async (c) => {
    const p = kiln.improvement.get(c.req.param("id"));
    if (!p) throw new HttpError(404, "unknown proposal");
    need(c, "definitions:write", p.factory);
    const body = await c.req.json().catch(() => ({}));
    return c.json(c.req.param("action") === "approve" ? kiln.improvement.approve(p.id, who(c)) : kiln.improvement.reject(p.id, who(c), (body as { reason?: string }).reason));
  });
  app.get("/api/v1/factories/:id/benchmarks", (c) => {
    const id = c.req.param("id");
    need(c, "read", id);
    const results = kiln.benchmarks.results(id);
    const suites = [...new Set(results.map((r) => r.suite))];
    return c.json({ suites: Object.keys(kiln.defs.current(id).parsed.benchmarks), results, summary: Object.fromEntries(suites.map((s) => [s, kiln.benchmarks.summarize(results.filter((r) => r.suite === s))])) });
  });
  app.post("/api/v1/factories/:id/benchmarks/:suite/run", async (c) => {
    const { id, suite } = c.req.param();
    need(c, "definitions:write", id);
    return c.json(await kiln.benchmarks.run(id, suite, who(c)));
  });
  app.post("/api/v1/factories/:id/benchmarks/:suite/router", async (c) => {
    const { id, suite } = c.req.param();
    need(c, "definitions:write", id);
    return c.json((await kiln.benchmarks.proposeRouter(id, suite, who(c))) ?? { rules: [] });
  });

  // memories and skills
  app.get("/api/v1/factories/:id/memories", (c) => {
    const id = c.req.param("id");
    need(c, "read", id);
    return c.json(kiln.store.list("memories", (m: { id: string; factory: string }) => m.factory === id));
  });
  app.post("/api/v1/factories/:id/memories", async (c) => {
    const id = c.req.param("id");
    need(c, "send", id);
    const body = S.Memory.parse(await c.req.json());
    return c.json(kiln.memories.propose(id, { ...body, author: who(c) }), 201);
  });
  app.post("/api/v1/memories/:id/:action{accept|reject}", async (c) => {
    const m = kiln.store.get<{ id: string; factory: string }>("memories", c.req.param("id"));
    if (!m) throw new HttpError(404, "unknown memory");
    need(c, "definitions:write", m.factory);
    if (c.req.param("action") === "accept") return c.json(await kiln.memories.accept(m.id, who(c)));
    kiln.memories.reject(m.id, who(c));
    return c.json({ ok: true });
  });
  app.get("/api/v1/skills", (c) => c.json({ catalog: kiln.skills.catalog(), listings: kiln.skills.listings() }));
  app.post("/api/v1/skills/publish", async (c) => {
    const body = S.Publish.parse(await c.req.json());
    need(c, "definitions:write", body.factory);
    return c.json(kiln.skills.publish(body.factory, body.name, who(c)), 201);
  });
  app.post("/api/v1/skills/:id/install", async (c) => {
    const { factory } = S.Install.parse(await c.req.json());
    need(c, "definitions:write", factory);
    return c.json(await kiln.skills.install(c.req.param("id"), factory, who(c)));
  });

  // admin
  app.get("/api/v1/audit", (c) => {
    need(c, "admin", "*");
    return c.json(kiln.auditLog(Number(c.req.query("limit") ?? 200)));
  });
  app.get("/api/v1/decisions", (c) => {
    const wi = c.req.query("workItem");
    return c.json(kiln.store.list("decision_logs", (d: { id: string; workItemId?: string }) => !wi || d.workItemId === wi).slice(-500));
  });
  app.get("/api/v1/tokens", (c) => {
    need(c, "admin", "*");
    return c.json(kiln.store.list<ApiToken>("api_tokens").map(({ hash: _h, ...t }) => t));
  });
  app.post("/api/v1/tokens", async (c) => {
    need(c, "admin", "*");
    const body = S.Token.parse(await c.req.json());
    const { token, record } = issueToken(kiln.store, { ...body, now: kiln.clock.now() });
    kiln.audit(who(c), "token.issued", record.id, { grants: record.grants });
    const { hash: _h, ...rest } = record;
    return c.json({ token, record: rest }, 201);
  });
  app.get("/api/v1/scopes", (c) => c.json(SCOPES));
  app.get("/api/v1/integrations", (c) =>
    c.json({
      forge: kiln.forge.name,
      tracker: kiln.tracker?.name ?? "none",
      chat: kiln.chat?.name ?? "none",
      preview: kiln.preview?.name ?? "none",
      decisions: { primary: kiln.decide.primary.name, fallback: kiln.decide.fallback?.name ?? "none" },
      judge: kiln.judge.name,
      sandboxes: Object.keys(kiln.sandboxes),
      defaultBackend: kiln.options.defaultBackend ?? "local",
      agents: kiln.options.harness ? "scripted" : "harness CLIs",
      publicUrl: kiln.options.publicUrl,
    }),
  );
  app.get("/api/v1/secrets", (c) => {
    need(c, "admin", "*");
    return c.json(kiln.secrets.listSecretNames());
  });
  app.put("/api/v1/secrets/:name", async (c) => {
    need(c, "admin", "*");
    const { value } = z.object({ value: z.string().min(1) }).parse(await c.req.json());
    kiln.secrets.setSecret(c.req.param("name"), value);
    kiln.audit(who(c), "secret.set", c.req.param("name"));
    return c.json({ ok: true });
  });

  registerModules({ app, kiln, options, need, who, visible, canReadRun, canSendRun });
  return app;
}

/** Server-side secrets (webhook signing keys) come from the environment or the store, never from agents. */
function serverSecret(kiln: Kiln, name: string): string | undefined {
  return process.env[name] ?? kiln.secrets.getSecret(name);
}

function summarize(r: { started: { id: string; factory: string }[]; continued: string[]; duplicate: boolean }) {
  return { started: r.started.map((w) => ({ id: w.id, factory: w.factory })), continued: r.continued, duplicate: r.duplicate };
}

function summarizeItem(kiln: Kiln, id: string) {
  const wi = kiln.workflow.get(id);
  return wi ? { id: wi.id, title: wi.title, state: wi.state, factory: wi.factory, pr: wi.pr, previewUrl: wi.previewUrl, spec: wi.spec } : undefined;
}
