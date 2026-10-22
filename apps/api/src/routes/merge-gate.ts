import type { MergeReview } from "@kiln/engine";
import { COLLECTIONS, targetOf, type App } from "@kiln/studio";
import type { Context } from "hono";
import { z } from "zod";
import type { Env, RouteContext } from "../app";
import { HttpError } from "../app";
import type { Route } from "../openapi";
import { appDefinitionsFor } from "./studio-definitions";

const ListQuery = z.object({ state: z.enum(["deciding", "merged", "needs_review", "closed"]).optional() });

export const routes: Route[] = [
  {
    method: "get",
    path: "/api/v1/merge-gate/reviews",
    summary: "Pull requests the merge gate judged for the current team's Studio Apps (?state=)",
    tag: "Merge gate",
  },
  {
    method: "get",
    path: "/api/v1/merge-gate/reviews/{id}",
    summary: "One merge gate review: merged or sent to review, the reasons and the merge-safety answers",
    tag: "Merge gate",
  },
];

/**
 * The merge gate's API (ADR-014) is read-only. Studio's shipping starts the gate in process when
 * the author marks a pull request ready for review, and the switch is in the App's or factory's
 * policies, so nothing here can turn the gate on or make it merge. People only: run tokens and
 * agent keys are refused.
 */
export function register({ app, kiln, access, user, team, need }: RouteContext) {
  // An App's switch is its definition's `mergeGate` policy (ADR-014), off by default and edited only by people.
  // An unknown App, or one outside the team the request names, is off.
  kiln.mergeGate.useAppPolicy(({ appId, team: teamId }) => {
    const found = kiln.store.get<App>(COLLECTIONS.apps, appId);
    return found !== undefined && found.team === teamId && appDefinitionsFor(kiln).policy(targetOf(found)).mergeGate;
  });
  const person = (c: Context<Env>) => {
    if (access(c).token.type === "agent") throw new HttpError(403, "agent keys cannot read merge gate reviews");
    return user(c);
  };
  const inTeam = (c: Context<Env>, teamId: string) => access(c).superuser || kiln.teams.role(teamId, person(c).id) !== undefined;
  const visible = (c: Context<Env>, r: MergeReview) => {
    if (r.scope.kind === "app") return inTeam(c, r.scope.team);
    person(c);
    need(c, "read", r.scope.factory);
    return true;
  };

  app.get("/api/v1/merge-gate/reviews", (c) => {
    person(c);
    const { state } = ListQuery.parse({ state: c.req.query("state") });
    return c.json({ reviews: kiln.mergeGate.list({ team: team(c).id, ...(state ? { state: [state] } : {}) }) });
  });

  app.get("/api/v1/merge-gate/reviews/:id", (c) => {
    const r = kiln.mergeGate.get(c.req.param("id"));
    if (!r || !visible(c, r)) throw new HttpError(404, "unknown review");
    return c.json(r);
  });
}
