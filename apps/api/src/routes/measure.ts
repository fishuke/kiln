import { z } from "zod";
import type { RouteContext } from "../app";
import type { Route } from "../openapi";
import { limit, listOf, queryObject, range, RangeQuery } from "./util";

const BreakdownQuery = RangeQuery.extend({ group_by: z.enum(["source", "user", "agent", "model"]) });
const RunBreakdownQuery = RangeQuery.extend({ group_by: z.enum(["agent_type", "status", "source", "root_vs_subrun", "model", "harness"]) });
const TopQuery = RangeQuery.extend({ limit: limit(50) });
const PrQuery = z
  .object({
    limit: limit(500),
    cursor: z.string().optional(),
    repo: z.string().optional(),
    state: listOf(z.enum(["open", "draft", "merged", "closed"])),
    opened_after: z.string().optional(),
    opened_before: z.string().optional(),
    merged_after: z.string().optional(),
    merged_before: z.string().optional(),
    updated_after: z.string().optional(),
  })
  .passthrough();

const range_ = "start_date, end_date (RFC 3339, default last 30 days), group_by_period day|week|month";

export const routes: Route[] = [
  { method: "get", path: "/api/v1/factories/{id}/metrics", summary: `Runs, PRs, merged, autonomy funnel, impact, PR latency medians, human interactions per PR, deltas (${range_})`, scope: "read", tag: "Measure" },
  { method: "get", path: "/api/v1/factories/{id}/costs/per-pr", summary: `Cost per PR: total, mean, median by component (${range_})`, scope: "read", tag: "Measure" },
  { method: "get", path: "/api/v1/factories/{id}/costs/breakdown", summary: "Spend by group_by=source|user|agent|model (source and user roll up to the root run)", scope: "read", tag: "Measure" },
  { method: "get", path: "/api/v1/factories/{id}/costs/per-pr/top", summary: "Most expensive PRs (?limit ≤ 50, default 20)", scope: "read", tag: "Measure" },
  { method: "get", path: "/api/v1/factories/{id}/costs/per-pr/by-size", summary: "Cost per PR by size: S < 100, M < 500, L < 1000, XL changed lines", scope: "read", tag: "Measure" },
  { method: "get", path: "/api/v1/factories/{id}/metrics/run-breakdown", summary: "Run counts by group_by=agent_type|status|source|root_vs_subrun|model|harness", scope: "read", tag: "Measure" },
  { method: "get", path: "/api/v1/factories/{id}/pull-requests", summary: "PRs produced by the factory: repo, state[], opened/merged after/before, updated_after, cursor", scope: "read", tag: "Measure" },
];

/** Factory metrics, costs and pull requests. */
export function register({ app, kiln, need }: RouteContext) {
  app.get("/api/v1/factories/:id/metrics", (c) => {
    const id = c.req.param("id");
    need(c, "read", id);
    return c.json(kiln.factoryMetrics.metrics(id, range(RangeQuery.parse(queryObject(c)))));
  });
  app.get("/api/v1/factories/:id/costs/per-pr", (c) => {
    const id = c.req.param("id");
    need(c, "read", id);
    return c.json(kiln.factoryMetrics.costPerPr(id, range(RangeQuery.parse(queryObject(c)))));
  });
  app.get("/api/v1/factories/:id/costs/breakdown", (c) => {
    const id = c.req.param("id");
    need(c, "read", id);
    const q = BreakdownQuery.parse(queryObject(c));
    return c.json(kiln.factoryMetrics.costBreakdown(id, q.group_by, range(q)));
  });
  app.get("/api/v1/factories/:id/costs/per-pr/top", (c) => {
    const id = c.req.param("id");
    need(c, "read", id);
    const q = TopQuery.parse(queryObject(c));
    return c.json(kiln.factoryMetrics.topPrs(id, { ...range(q), limit: q.limit }));
  });
  app.get("/api/v1/factories/:id/costs/per-pr/by-size", (c) => {
    const id = c.req.param("id");
    need(c, "read", id);
    return c.json(kiln.factoryMetrics.costBySize(id, range(RangeQuery.parse(queryObject(c)))));
  });
  app.get("/api/v1/factories/:id/metrics/run-breakdown", (c) => {
    const id = c.req.param("id");
    need(c, "read", id);
    const q = RunBreakdownQuery.parse(queryObject(c));
    return c.json(kiln.factoryMetrics.runBreakdown(id, q.group_by, range(q)));
  });
  app.get("/api/v1/factories/:id/pull-requests", (c) => {
    const id = c.req.param("id");
    need(c, "read", id);
    const q = PrQuery.parse(queryObject(c));
    return c.json(
      kiln.factoryMetrics.pullRequests(id, { limit: q.limit, cursor: q.cursor, repo: q.repo, state: q.state, openedAfter: q.opened_after, openedBefore: q.opened_before, mergedAfter: q.merged_after, mergedBefore: q.merged_before, updatedAfter: q.updated_after }),
    );
  });
}
