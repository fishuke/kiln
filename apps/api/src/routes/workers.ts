import { serverMetrics, type WorkerEvent, type WorkerResult } from "@kiln/engine";
import type { Context } from "hono";
import { z } from "zod";
import type { Env, RouteContext } from "../app";
import { HttpError } from "../app";
import type { Route } from "../openapi";

export const Connect = z.object({
  workerId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/),
  backend: z.enum(["docker", "kubernetes", "direct"]),
  version: z.string().optional(),
  maxConcurrent: z.number().int().min(0).max(1000).default(0),
  instance: z.string().regex(/^wkr_[a-z0-9]+$/).optional(),
});
const Event = z.object({ type: z.enum(["message", "reasoning", "tool_call", "tool_result", "steer", "error", "artifact", "pushed", "started", "log"]), text: z.string().optional(), data: z.unknown().optional() });
export const Events = z.object({ events: z.array(Event).max(500) });
export const Complete = z.object({
  outcome: z.enum(["succeeded", "failed", "cancelled"]),
  summary: z.string().default(""),
  costUsd: z.number().min(0).default(0),
  result: z.record(z.string(), z.unknown()).optional(),
  artifacts: z.array(z.object({ name: z.string().min(1).max(200), contentType: z.string(), base64: z.string() })).max(50).default([]),
  pushed: z.array(z.object({ repo: z.string(), branch: z.string(), sha: z.string() })).default([]),
  startRepos: z.array(z.object({ name: z.string(), key: z.string(), sha: z.string(), branch: z.string().optional() })).default([]),
  diffStat: z.object({ additions: z.number(), deletions: z.number(), files: z.number() }).optional(),
  workspaceSha: z.string().optional(),
  error: z.string().optional(),
});

export const routes: Route[] = [
  { method: "get", path: "/api/v1/workers", summary: "Connected self-hosted workers with their last heartbeat, and the run queue", scope: "read", tag: "Workers" },
  { method: "post", path: "/api/v1/workers/connect", summary: "A worker process connects (kiln worker) and gets its instance id", scope: "worker", body: Connect, tag: "Workers" },
  { method: "post", path: "/api/v1/workers/{instance}/heartbeat", summary: "Heartbeat; the reply carries cancellations and steering for its runs", scope: "worker", tag: "Workers" },
  { method: "post", path: "/api/v1/workers/{instance}/claim", summary: "Long-poll for a run routed to this worker id (?wait= seconds, default 25)", scope: "worker", tag: "Workers" },
  { method: "post", path: "/api/v1/workers/{instance}/runs/{runId}/events", summary: "Stream a run's events back", scope: "worker", body: Events, tag: "Workers" },
  { method: "post", path: "/api/v1/workers/{instance}/runs/{runId}/complete", summary: "Report a run's result, artifacts and pushed branches", scope: "worker", body: Complete, tag: "Workers" },
  { method: "delete", path: "/api/v1/workers/{instance}", summary: "Disconnect; its running runs fail and are retried", scope: "worker", tag: "Workers" },
  { method: "get", path: "/metrics", summary: "Prometheus metrics (KILN_METRICS_TOKEN protects it when set)", tag: "System" },
];

/** Self-hosted workers: registry, long-poll claims, event streaming, and Prometheus metrics. */
export function register({ app, kiln, need, who }: RouteContext) {
  // Worker API keys (type worker) or tokens with the worker scope.
  const needWorker = (c: Context<Env>) => {
    if (c.get("token").type === "worker") return;
    need(c, "worker", "*");
  };
  const worker = (c: Context<Env>) => {
    needWorker(c);
    const instance = c.req.param("instance")!;
    const w = kiln.workers.get(instance);
    if (!w) throw new HttpError(404, `unknown worker ${instance}; connect first`);
    if (w.owner !== who(c)) throw new HttpError(403, "this worker connected with another key");
    return instance;
  };

  app.get("/api/v1/workers", (c) => {
    need(c, "read", "*");
    return c.json({ workers: kiln.workers.connected(), queue: kiln.workers.queued() });
  });
  app.post("/api/v1/workers/connect", async (c) => {
    needWorker(c);
    const body = Connect.parse(await c.req.json());
    return c.json(kiln.workers.connect({ ...body, owner: who(c) }), 201);
  });
  app.post("/api/v1/workers/:instance/heartbeat", (c) => c.json(kiln.workers.heartbeat(worker(c))));
  app.post("/api/v1/workers/:instance/claim", async (c) => {
    const instance = worker(c);
    const wait = Math.min(Math.max(Number(c.req.query("wait") ?? 25), 0), 55) * 1000;
    const r = await kiln.workers.claim(instance, wait);
    return c.json(r);
  });
  app.post("/api/v1/workers/:instance/runs/:runId/events", async (c) => {
    const instance = worker(c);
    const { events } = Events.parse(await c.req.json());
    return c.json(kiln.workers.events(instance, c.req.param("runId"), events as WorkerEvent[]));
  });
  app.post("/api/v1/workers/:instance/runs/:runId/complete", async (c) => {
    const instance = worker(c);
    const body = Complete.parse(await c.req.json());
    kiln.workers.complete(instance, c.req.param("runId"), body as WorkerResult);
    return c.json({ ok: true });
  });
  app.delete("/api/v1/workers/:instance", (c) => {
    kiln.workers.disconnect(worker(c));
    return c.json({ ok: true });
  });

  app.get("/metrics", (c) => {
    const required = process.env.KILN_METRICS_TOKEN;
    if (required && c.req.header("authorization") !== `Bearer ${required}`) return c.text("unauthorized\n", 401);
    return c.text(serverMetrics(kiln), 200, { "content-type": "text/plain; version=0.0.4" });
  });
}
