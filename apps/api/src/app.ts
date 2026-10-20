import { can, issueToken, SCOPES, teamRoleAllows, verifyToken, type ApiToken, type GitHubOAuth, type Scope } from "@kiln/auth";
import { guardCommand } from "@kiln/decide";
import { BudgetExceededError, PlatformError, resolveAccess, type Access, type Gate, type Kiln, type Team, type User } from "@kiln/engine";
import { Hono, type Context } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { openApiDocument } from "./openapi";
import { registerModules, registerPublicRoutes } from "./routes";
import * as S from "./schemas";

export type Env = { Variables: { token: ApiToken; access: Access } };

export class HttpError extends Error {
  constructor(
    readonly status: 400 | 401 | 402 | 403 | 404 | 409 | 410 | 413,
    message: string,
  ) {
    super(message);
  }
}

export type AppOptions = {
  /** Every request acts as the seeded owner dev@kiln.local with admin on everything. Only for local development. */
  devAuth?: boolean;
  /** Mounted at /mcp when given. */
  mcp?: (req: Request) => Promise<Response>;
  /** GitHub login, when GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET are set. */
  github?: GitHubOAuth;
  /** Anyone may sign up and join the default team (KILN_OPEN_SIGNUP=1). Otherwise signup needs an invite. */
  openSignup?: boolean;
};

/** Routes reachable without a token: signup, login, GitHub login, invite previews. */
const PUBLIC_ROUTES = [/^\/api\/v1\/auth\/(signup|login|providers|github\/start|github\/callback)$/, /^\/api\/v1\/invites\/kinv_[\w-]+$/];

const GATE_SCOPE: Record<Gate["kind"], Scope> = { spec: "decide:spec", preview: "decide:preview", question: "decide:question", merge: "decide:merge", custom: "decide:merge" };

/** What a route module gets: the app, the Kiln container and the auth helpers. */
export type RouteContext = {
  app: Hono<Env>;
  kiln: Kiln;
  options: AppOptions;
  need: (c: Context<Env>, scope: Scope, factory: string | "*") => void;
  who: (c: Context<Env>) => string;
  visible: (c: Context<Env>, factory: string) => boolean;
  /** The caller, team and grants of this request. */
  access: (c: Context<Env>) => Access;
  /** The calling user; 403 for tokens that do not act as a user. */
  user: (c: Context<Env>) => User;
  /** The current team (X-Kiln-Team, else the default); 400 when there is none. */
  team: (c: Context<Env>) => Team;
};

export function createApp(kiln: Kiln, options: AppOptions = {}) {
  const app = new Hono<Env>();
  // Factories created before teams existed move into the default team.
  kiln.teams.ensureDefaultTeam();
  const devToken: ApiToken | undefined = options.devAuth
    ? { id: "tok_dev", name: "dev", subject: "dev@kiln.local", hash: "", grants: [{ scope: "admin", factory: "*" }], createdAt: new Date(0).toISOString(), type: "session", userId: kiln.users.ensureDevUser().id }
    : undefined;

  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ error: err.message }, err.status);
    if (err instanceof PlatformError) return c.json({ error: err.message }, err.status);
    if (err instanceof BudgetExceededError) return c.json({ error: err.code, message: err.message, limitUsd: err.limitUsd, spentUsd: err.spentUsd }, 402);
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

  // Auth helpers for route modules (closures over the access the middleware below sets).
  const access = (c: Context<Env>) => {
    const a = c.get("access");
    if (!a) throw new HttpError(401, "missing or invalid token");
    return a;
  };
  const need = (c: Context<Env>, scope: Scope, factory: string | "*") => {
    const a = access(c);
    if (can(a.token, scope, factory)) return;
    // Team-wide actions, or a factory that does not exist yet: the team role decides.
    const teamWide = factory === "*" || !kiln.defs.get(factory);
    if (teamWide && a.user && teamRoleAllows(a.teamRole, scope)) return;
    throw new HttpError(403, `token lacks ${scope} on ${factory}`);
  };
  const who = (c: Context<Env>) => access(c).token.subject;
  const visible = (c: Context<Env>, factory: string) => {
    const a = access(c);
    if (!can(a.token, "read", factory) && !can(a.token, "send", factory)) return false;
    return !a.teamScoped || !a.team || kiln.teams.factoryTeam(factory) === a.team.id;
  };
  const user = (c: Context<Env>) => {
    const u = access(c).user;
    if (!u) throw new HttpError(403, "this needs a user token (log in, or use a personal API key)");
    return u;
  };
  const team = (c: Context<Env>) => {
    const t = access(c).team;
    if (!t) throw new HttpError(400, "you are not in a team yet; accept an invite or create a team");
    return t;
  };
  /** A factory created by this request belongs to the caller's current team. */
  const adopt = (c: Context<Env>, before: Set<string>) => {
    const t = access(c).team;
    if (!t) return;
    for (const f of kiln.defs.list()) if (!before.has(f.id) && f.team !== t.id) kiln.teams.assignFactory(f.id, t.id, who(c));
  };
  const known = () => new Set(kiln.defs.list().map((f) => f.id));
  /** Enabled GitHub orgs: when a team lists any, its factories may only use repos in them. */
  const checkOrgs = (c: Context<Env>, repos: { owner: string; forge?: string }[]) => {
    const t = access(c).team;
    const orgs = t ? kiln.teams.settings(t.id).githubOrgs.map((o) => o.toLowerCase()) : [];
    const outside = orgs.length ? repos.filter((r) => (r.forge ?? "github") === "github" && !orgs.includes(r.owner.toLowerCase())) : [];
    if (outside.length) throw new HttpError(403, `GitHub org ${outside[0]!.owner} is not enabled for team ${t!.slug}`);
  };
  const ctx: RouteContext = { app, kiln, options, need, who, visible, access, user, team };

  // ---- webhooks and OAuth callbacks: public, verified per provider (routes/webhooks.ts) ----
  registerPublicRoutes(ctx);

  // ---- MCP (streamable HTTP) ----
  if (options.mcp) app.all("/mcp", (c) => options.mcp!(c.req.raw));

  // ---- authenticated API ----
  app.use("/api/v1/*", async (c, next) => {
    const raw = c.req.header("authorization")?.replace(/^Bearer\s+/i, "");
    const verified = raw ? verifyToken(kiln.store, raw, kiln.clock.now()) : undefined;
    const token = verified ?? devToken;
    if (!token) {
      if (PUBLIC_ROUTES.some((r) => r.test(c.req.path))) return next();
      throw new HttpError(401, "missing or invalid token");
    }
    const access = resolveAccess(kiln, token, c.req.header("x-kiln-team") || undefined);
    c.set("access", access);
    c.set("token", access.token);
    return next();
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
    const target = body.factory ?? (v.ok ? kiln.defs.resolveTree(body.tree).factory.alias : undefined) ?? "*";
    need(c, "definitions:write", target);
    if (v.ok) checkOrgs(c, kiln.defs.resolveTree(body.tree).factory.repositories);
    const before = known();
    const r = kiln.defs.applyAny(body.tree, { author: who(c), factory: body.factory, canaryPercent: body.canaryPercent, dryRun: body.dryRun });
    adopt(c, before);
    return c.json(r, r.ok ? 200 : 400);
  });
  app.post("/api/v1/factories/connect", async (c) => {
    const body = S.Connect.parse(await c.req.json());
    need(c, "definitions:write", "*");
    checkOrgs(c, [{ owner: body.owner, forge: "github" }]);
    const before = known();
    const r = await kiln.defs.connectRepo(body, who(c));
    adopt(c, before);
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
    const body = S.CreateWorkItem.parse(await c.req.json());
    need(c, "send", body.factory);
    kiln.usage.assertWithinBudget(kiln.teams.factoryTeam(body.factory));
    const wi = await kiln.workflow.create({ ...body, source: { provider: body.via ?? "api" }, requester: who(c) });
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
    const { text } = S.Message.parse(await c.req.json());
    const open = kiln.gates.list({ workItemId: wi.id, state: "open" }).find((g) => g.kind === "question" && !g.command);
    if (open) await kiln.gates.decide(open.id, { decision: "answer", answer: text, by: who(c), via: "web" });
    else kiln.workflow.addMessage(wi.id, who(c), text);
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
    void kiln.workflow.advance(wi.id);
    return c.json(kiln.workflow.get(wi.id));
  });

  // runs
  app.get("/api/v1/runs", (c) => {
    const runs = kiln.runs.list({ factory: c.req.query("factory"), workItemId: c.req.query("workItem"), agent: c.req.query("agent"), kind: c.req.query("kind") as never }).filter((r) => visible(c, r.factory));
    return c.json(runs.slice(0, Number(c.req.query("limit") ?? 200)));
  });
  app.get("/api/v1/runs/:id", (c) => {
    const run = kiln.runs.get(c.req.param("id"));
    if (!run) throw new HttpError(404, "unknown run");
    need(c, "read", run.factory);
    return c.json({ ...run, live: kiln.runs.isActive(run.id), scores: kiln.scoring.list({ runId: run.id }) });
  });
  app.get("/api/v1/runs/:id/events", (c) => {
    const run = kiln.runs.get(c.req.param("id"));
    if (!run) throw new HttpError(404, "unknown run");
    need(c, "read", run.factory);
    return c.json(kiln.runs.events(run.id, Number(c.req.query("after") ?? 0)));
  });
  app.get("/api/v1/runs/:id/stream", (c) => {
    const run = kiln.runs.get(c.req.param("id"));
    if (!run) throw new HttpError(404, "unknown run");
    need(c, "read", run.factory);
    return streamSSE(c, async (stream) => {
      let after = Number(c.req.query("after") ?? 0);
      for (;;) {
        for (const e of kiln.runs.events(run.id, after)) {
          await stream.writeSSE({ id: String(e.seq), event: e.type, data: JSON.stringify(e) });
          after = e.seq;
        }
        const r = kiln.runs.get(run.id);
        if (r && r.status !== "running" && !kiln.runs.isActive(run.id)) break;
        await stream.sleep(500);
      }
    });
  });
  app.post("/api/v1/runs/:id/steer", async (c) => {
    const run = kiln.runs.get(c.req.param("id"));
    if (!run) throw new HttpError(404, "unknown run");
    need(c, "send", run.factory);
    const { text } = S.Message.parse(await c.req.json());
    await kiln.runs.steer(run.id, text, who(c));
    return c.json({ ok: true });
  });
  app.post("/api/v1/runs/:id/:action{replay|cancel|pause|resume}", async (c) => {
    const run = kiln.runs.get(c.req.param("id"));
    if (!run) throw new HttpError(404, "unknown run");
    need(c, "send", run.factory);
    const action = c.req.param("action");
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
    return c.json(gates.map((g) => ({ ...g, workItem: summarizeItem(kiln, g.workItemId) })));
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
    const body = (await c.req.json().catch(() => ({}))) as { reason?: string; force?: boolean };
    // Factory Admins may force a change that waits for a second approval.
    if (body.force) need(c, "admin", p.factory);
    return c.json(c.req.param("action") === "approve" ? kiln.improvement.approve(p.id, who(c), { force: body.force }) : kiln.improvement.reject(p.id, who(c), body.reason));
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

  // admin: server admins see every team; team owners and admins see their own team
  const teamAdminScope = (c: Context<Env>) => {
    need(c, "admin", "*");
    const a = access(c);
    if (a.serverAdmin) return undefined;
    if (!a.team) throw new HttpError(403, "team owners and admins only");
    return a.team.id;
  };
  app.get("/api/v1/audit", (c) => {
    const teamId = teamAdminScope(c);
    return c.json(kiln.auditLog(Number(c.req.query("limit") ?? 200), teamId));
  });
  app.get("/api/v1/decisions", (c) => {
    const wi = c.req.query("workItem");
    return c.json(kiln.store.list("decision_logs", (d: { id: string; workItemId?: string }) => !wi || d.workItemId === wi).slice(-500));
  });
  app.get("/api/v1/tokens", (c) => {
    const teamId = teamAdminScope(c);
    const members = teamId ? new Set(kiln.teams.members(teamId).map((m) => m.userId)) : undefined;
    const mine = (t: ApiToken) => !teamId || t.teamId === teamId || (!t.teamId && t.userId !== undefined && members!.has(t.userId));
    return c.json(kiln.store.list<ApiToken>("api_tokens", mine).map(({ hash: _h, ...t }) => t));
  });
  app.post("/api/v1/tokens", async (c) => {
    const teamId = teamAdminScope(c);
    const body = S.Token.parse(await c.req.json());
    if (teamId) {
      // A team admin's tokens reach only the team's factories, never every factory.
      const own = new Set(kiln.teams.factoriesOf(teamId).map((f) => f.id));
      const outside = body.grants.find((g) => g.factory === "*" || !own.has(g.factory));
      if (outside) throw new HttpError(403, `team admins can only grant scopes on their team's factories (not ${outside.factory})`);
    }
    const { token, record } = issueToken(kiln.store, { ...body, now: kiln.clock.now(), teamId, createdBy: who(c) });
    kiln.audit(who(c), "token.issued", record.id, { grants: record.grants, team: teamId });
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
  // Server secrets for server admins; for team admins these act on the team's raw secrets.
  app.get("/api/v1/secrets", (c) => {
    const teamId = teamAdminScope(c);
    if (!teamId) return c.json(kiln.secrets.listSecretNames());
    return c.json(kiln.vault.list({ teamId }).filter((s) => s.scope === "team").map((s) => s.name));
  });
  app.put("/api/v1/secrets/:name", async (c) => {
    const teamId = teamAdminScope(c);
    const { value } = z.object({ value: z.string().min(1) }).parse(await c.req.json());
    if (teamId) {
      const name = c.req.param("name");
      const existing = kiln.vault.getMeta("team", teamId, name);
      kiln.vault.set({ scope: "team", owner: teamId, name, value, type: existing?.type ?? "raw" }, who(c));
      return c.json({ ok: true, scope: "team" });
    }
    kiln.secrets.setSecret(c.req.param("name"), value);
    kiln.audit(who(c), "secret.set", c.req.param("name"));
    return c.json({ ok: true });
  });

  registerModules(ctx);
  return app;
}

function summarizeItem(kiln: Kiln, id: string) {
  const wi = kiln.workflow.get(id);
  return wi ? { id: wi.id, title: wi.title, state: wi.state, factory: wi.factory, pr: wi.pr, previewUrl: wi.previewUrl, spec: wi.spec } : undefined;
}
