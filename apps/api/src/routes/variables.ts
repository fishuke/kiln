import { isTeamAdmin } from "@kiln/auth";
import type { VariableScope } from "@kiln/engine";
import { COLLECTIONS, type App } from "@kiln/studio";
import type { Context } from "hono";
import { HttpError, type Env, type RouteContext } from "../app";
import { currentTeam } from "./platform-helpers";
import * as PS from "./platform-schemas";

/**
 * Project environments (docs/specs/project-environments.md): variable layers for the team, a
 * project, a factory or a Studio App, one per environment name. Secret values are write-only.
 */
export function variableRoutes(ctx: RouteContext) {
  const { app, kiln } = ctx;
  const studioApp = (id: string) => kiln.store.get<App>(COLLECTIONS.apps, id);

  /** The owner's team must be the current team; otherwise the owner does not exist for the caller. */
  const inTeam = (c: Context<Env>, scope: VariableScope, owner: string) => {
    const current = currentTeam(ctx, c);
    if (kiln.variables.teamOf(scope, owner, studioApp(owner)?.team) !== current.team.id) throw new HttpError(404, `unknown ${scope} ${owner}`);
    return current;
  };

  /** Team: admins. Project: admins or its owner. Factory: admin on it. App: admins or its creator. */
  const mayChange = (c: Context<Env>, scope: VariableScope, owner: string) => {
    const { team, role } = inTeam(c, scope, owner);
    const admin = isTeamAdmin(role);
    if (scope === "factory") ctx.need(c, "admin", owner);
    else if (scope === "team" && !admin) throw new HttpError(403, "team owners and admins only");
    else if (scope === "project" && !admin && kiln.planning.project(owner)?.owner !== ctx.who(c))
      throw new HttpError(403, "team admins or the project's owner only");
    else if (scope === "app" && !admin && studioApp(owner)?.createdBy !== ctx.who(c)) throw new HttpError(403, "team admins or the App's creator only");
    return team;
  };

  const layerParams = (c: Context<Env>) => {
    return PS.VariableLayerParams.parse({ scope: c.req.param("scope"), owner: c.req.param("owner"), environment: c.req.param("environment") });
  };

  app.get("/api/v1/variables", (c) => {
    const { scope, owner } = PS.VariableQuery.parse(c.req.query());
    inTeam(c, scope, owner);
    return c.json(kiln.variables.list(scope, owner));
  });

  // What runs and previews get: a factory in no project gets nothing; an App or factory brings its project.
  app.get("/api/v1/variables/resolve", (c) => {
    const q = PS.ResolveVariablesQuery.parse(c.req.query());
    const { team } = currentTeam(ctx, c);
    if (q.factory && q.app) throw new HttpError(400, "resolve variables for a factory or an App, not both");
    if (q.factory) {
      inTeam(c, "factory", q.factory);
      const project = kiln.defs.get(q.factory)?.projectId;
      return c.json({ variables: project ? kiln.variables.explain({ team: team.id, project, factory: q.factory, environment: q.environment }) : [] });
    }
    if (q.app) {
      inTeam(c, "app", q.app);
      return c.json({ variables: kiln.variables.explain({ team: team.id, project: studioApp(q.app)!.projectId, app: q.app, environment: q.environment }) });
    }
    if (q.project) inTeam(c, "project", q.project);
    return c.json({ variables: kiln.variables.explain({ team: team.id, project: q.project, environment: q.environment }) });
  });

  app.put("/api/v1/variables/:scope/:owner/:environment", async (c) => {
    const p = layerParams(c);
    const team = mayChange(c, p.scope, p.owner);
    const body = PS.SetVariables.parse(await c.req.json());
    return c.json(kiln.variables.set({ ...p, team: team.id, variables: body.variables }, ctx.who(c)));
  });

  app.delete("/api/v1/variables/:scope/:owner/:environment", (c) => {
    const p = layerParams(c);
    mayChange(c, p.scope, p.owner);
    kiln.variables.delete(p.scope, p.owner, p.environment, ctx.who(c));
    return c.json({ ok: true });
  });
}
