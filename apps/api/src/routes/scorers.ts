import { z } from "zod";
import type { RouteContext } from "../app";
import type { Route } from "../openapi";
import { flag, limit, listOf, queryObject, range, RangeQuery } from "./util";

const Classification = z.object({ value: z.string().min(1), score: z.number().min(0).max(1), description: z.string().optional() });
const AgentRef = z.union([z.string().min(1), z.object({ name: z.string().min(1), includeDescendants: z.boolean().optional() })]);

export const CreateScorer = z.object({
  name: z.string().min(1).max(100),
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,59}$/).optional(),
  description: z.string().optional(),
  scoringPrompt: z.string().min(1),
  classifications: z.array(Classification).min(1).max(20),
  threshold: z.number().min(0).max(1),
  scopeMode: z.enum(["all_agents", "selected_agents"]),
  agents: z.array(AgentRef).optional(),
  samplingRate: z.number().min(0).max(100).optional(),
  model: z.string().min(1),
  selfImprovementEnabled: z.boolean().optional(),
  runner: z.string().optional(),
  secrets: z.array(z.string()).optional(),
  mcpServers: z.array(z.string()).optional(),
});
export const PatchScorer = CreateScorer.partial().omit({ slug: true });
export const DispatchRuns = z.object({ runIds: z.array(z.string().min(1)).min(1).max(100) });
export const DispatchScorers = z.object({ scorers: z.array(z.string().min(1)).min(1).max(100) });

export const routes: Route[] = [
  { method: "get", path: "/api/v1/factories/{id}/scorers", summary: "Scorers with result counts, last scored time and kind (user | benchmark_task_correctness)", scope: "read", tag: "Scorers" },
  { method: "post", path: "/api/v1/factories/{id}/scorers", summary: "Create a scorer (writes scorers/<slug>/scorer.md; a PR for repo-backed factories). Does not score past runs", scope: "definitions:write", body: CreateScorer, tag: "Scorers" },
  { method: "get", path: "/api/v1/factories/{id}/scorers/{slug}", summary: "One scorer with its rubric", scope: "read", tag: "Scorers" },
  { method: "patch", path: "/api/v1/factories/{id}/scorers/{slug}", summary: "Update a scorer (bumps its version)", scope: "definitions:write", body: PatchScorer, tag: "Scorers" },
  { method: "delete", path: "/api/v1/factories/{id}/scorers/{slug}", summary: "Delete a scorer and every score it recorded", scope: "definitions:write", tag: "Scorers" },
  { method: "get", path: "/api/v1/factories/{id}/scorers/{slug}/results", summary: "Results (classification, score, outcome, reason with include_reasons, run_id filter, cursor)", scope: "read", tag: "Scorers" },
  { method: "get", path: "/api/v1/factories/{id}/scorers/{slug}/metrics", summary: "Pass/fail counts, pass rate and series; include_cost adds judge cost", scope: "read", tag: "Scorers" },
  { method: "post", path: "/api/v1/factories/{id}/scorers/{slug}/dispatch", summary: "Score up to 100 runs now (bypasses sampling; re-scoring replaces)", scope: "send", body: DispatchRuns, tag: "Scorers" },
  { method: "post", path: "/api/v1/factories/{id}/runs/{runId}/scorer-dispatch", summary: "Score a run with up to 100 scorers now", scope: "send", body: DispatchScorers, tag: "Scorers" },
];

/** Scorers: CRUD, results, metrics and manual scoring. */
export function register({ app, kiln, need, who }: RouteContext) {
  app.get("/api/v1/factories/:id/scorers", (c) => {
    const id = c.req.param("id");
    need(c, "read", id);
    return c.json({ scorers: kiln.scorers.list(id) });
  });
  app.post("/api/v1/factories/:id/scorers", async (c) => {
    const id = c.req.param("id");
    need(c, "definitions:write", id);
    return c.json(await kiln.scorers.create(id, CreateScorer.parse(await c.req.json()), who(c)), 201);
  });
  app.get("/api/v1/factories/:id/scorers/:slug", (c) => {
    const { id, slug } = c.req.param();
    need(c, "read", id);
    return c.json(kiln.scorers.get(id, slug));
  });
  app.patch("/api/v1/factories/:id/scorers/:slug", async (c) => {
    const { id, slug } = c.req.param();
    need(c, "definitions:write", id);
    return c.json(await kiln.scorers.update(id, slug, PatchScorer.parse(await c.req.json()), who(c)));
  });
  app.delete("/api/v1/factories/:id/scorers/:slug", async (c) => {
    const { id, slug } = c.req.param();
    need(c, "definitions:write", id);
    return c.json(await kiln.scorers.remove(id, slug, who(c)));
  });
  app.get("/api/v1/factories/:id/scorers/:slug/results", (c) => {
    const { id, slug } = c.req.param();
    need(c, "read", id);
    const q = z.object({ limit: limit(200), cursor: z.string().optional(), include_reasons: flag, run_id: listOf(z.string()) }).passthrough().parse(queryObject(c));
    return c.json(kiln.scorers.results(id, slug, { limit: q.limit, cursor: q.cursor, includeReasons: q.include_reasons, runIds: q.run_id }));
  });
  app.get("/api/v1/factories/:id/scorers/:slug/metrics", (c) => {
    const { id, slug } = c.req.param();
    need(c, "read", id);
    const q = RangeQuery.extend({ include_cost: flag }).parse(queryObject(c));
    return c.json(kiln.scorers.metrics(id, slug, { ...range(q), includeCost: q.include_cost }));
  });
  app.post("/api/v1/factories/:id/scorers/:slug/dispatch", async (c) => {
    const { id, slug } = c.req.param();
    need(c, "send", id);
    const { runIds } = DispatchRuns.parse(await c.req.json());
    return c.json({ results: await kiln.scorers.dispatch(id, runIds, [slug], who(c)) });
  });
  app.post("/api/v1/factories/:id/runs/:runId/scorer-dispatch", async (c) => {
    const { id, runId } = c.req.param();
    need(c, "send", id);
    const { scorers } = DispatchScorers.parse(await c.req.json());
    return c.json({ results: await kiln.scorers.dispatch(id, [runId], scorers, who(c)) });
  });
}
