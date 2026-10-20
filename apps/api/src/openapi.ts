import { z } from "zod";
import { MODULES } from "./routes";
import * as S from "./schemas";

export type Route = { method: "get" | "post" | "put" | "patch" | "delete"; path: string; summary: string; scope?: string; body?: z.ZodType; tag: string };

/** The core routes in app.ts; route modules list their own and are appended below. */
const CORE: Route[] = [
  { method: "get", path: "/api/v1/health", summary: "Health check", tag: "System" },
  { method: "get", path: "/api/v1/me", summary: "The token's subject and grants", tag: "System" },
  { method: "post", path: "/api/v1/guard", summary: "Check a shell command against the guardrail (run token)", body: S.Guard, tag: "System" },
  { method: "get", path: "/api/v1/factories", summary: "List factories you can read", scope: "read", tag: "Factories" },
  { method: "get", path: "/api/v1/factories/{id}", summary: "A factory with its resolved definition", scope: "read", tag: "Factories" },
  { method: "get", path: "/api/v1/factories/{id}/definition", summary: "The definition tree at the applied (or given) sha", scope: "read", tag: "Definitions" },
  { method: "post", path: "/api/v1/definitions/validate", summary: "Validate a definition tree", body: S.Tree, tag: "Definitions" },
  { method: "post", path: "/api/v1/definitions/diff", summary: "Diff a tree against the applied definition", scope: "read", body: S.TreeFor, tag: "Definitions" },
  { method: "post", path: "/api/v1/definitions/apply", summary: "Apply a tree atomically, optionally as a canary or dry run", scope: "definitions:write", body: S.Apply, tag: "Definitions" },
  { method: "post", path: "/api/v1/factories/connect", summary: "Bind a factory to a GitHub config repo and apply it", scope: "definitions:write", body: S.Connect, tag: "Definitions" },
  { method: "post", path: "/api/v1/factories/{id}/sync", summary: "Pull the config repo and apply it", scope: "definitions:write", tag: "Definitions" },
  { method: "post", path: "/api/v1/factories/{id}/canary/{action}", summary: "Promote or roll back the canary definition", scope: "definitions:write", tag: "Definitions" },
  { method: "get", path: "/api/v1/work-items", summary: "List work items", scope: "read", tag: "Work items" },
  { method: "post", path: "/api/v1/work-items", summary: "Send work to a factory", scope: "send", body: S.CreateWorkItem, tag: "Work items" },
  { method: "get", path: "/api/v1/work-items/{id}", summary: "A work item with its runs, gates and decisions", scope: "read", tag: "Work items" },
  { method: "post", path: "/api/v1/work-items/{id}/messages", summary: "Message the foreman (answers an open question)", scope: "send", body: S.Message, tag: "Work items" },
  { method: "post", path: "/api/v1/work-items/{id}/cancel", summary: "Cancel a work item", scope: "send", tag: "Work items" },
  { method: "post", path: "/api/v1/work-items/{id}/complete", summary: "Confirm a handed-off item landed (human only)", scope: "decide:merge", tag: "Work items" },
  { method: "post", path: "/api/v1/work-items/{id}/pull", summary: "Take a task to a local worktree", scope: "send", tag: "Work items" },
  { method: "post", path: "/api/v1/work-items/{id}/handback", summary: "Hand a local task back to the factory", scope: "send", body: S.Message, tag: "Work items" },
  { method: "get", path: "/api/v1/runs", summary: "List runs: state[], task_status[], source[], factory_uid[], ancestor_run_id, artifact_type, q, creator, mine, created/updated filters, metadata[key]=, sort_by, cursor", scope: "read", tag: "Runs" },
  { method: "get", path: "/api/v1/runs/{id}", summary: "A run with its state, source, root run, task and scores", scope: "read", tag: "Runs" },
  { method: "get", path: "/api/v1/runs/{id}/events", summary: "Run events after a sequence number", scope: "read", tag: "Runs" },
  { method: "get", path: "/api/v1/runs/{id}/stream", summary: "Run events as server-sent events", scope: "read", tag: "Runs" },
  { method: "post", path: "/api/v1/runs/{id}/steer", summary: "Send a steering message to a running agent", scope: "send", body: S.Message, tag: "Runs" },
  { method: "post", path: "/api/v1/runs/{id}/replay", summary: "Replay from the saved start state, optionally under another sha", scope: "send", body: S.Replay, tag: "Runs" },
  { method: "post", path: "/api/v1/runs/{id}/pause", summary: "Snapshot and pause a running agent", scope: "send", tag: "Runs" },
  { method: "post", path: "/api/v1/runs/{id}/resume", summary: "Resume a paused run on any node", scope: "send", tag: "Runs" },
  { method: "post", path: "/api/v1/runs/{id}/cancel", summary: "Cancel a run", scope: "send", tag: "Runs" },
  { method: "post", path: "/api/v1/runs/{id}/save-benchmark", summary: "Save a finished run as a benchmark task", scope: "definitions:write", body: S.SaveBenchmark, tag: "Benchmarks" },
  { method: "get", path: "/api/v1/inbox", summary: "Open decisions (gates), most urgent first", tag: "Inbox" },
  { method: "get", path: "/api/v1/gates/{id}", summary: "A gate with its work item", scope: "read", tag: "Inbox" },
  { method: "post", path: "/api/v1/gates/{id}/decide", summary: "Approve, reject or answer (scope depends on the gate kind)", scope: "decide:*", body: S.Decide, tag: "Inbox" },
  { method: "get", path: "/api/v1/projects", summary: "List projects", tag: "Planning" },
  { method: "post", path: "/api/v1/projects", summary: "Create a project over factories", scope: "send", body: S.Project, tag: "Planning" },
  { method: "get", path: "/api/v1/projects/{id}", summary: "A project with its roadmap and work items", tag: "Planning" },
  { method: "post", path: "/api/v1/projects/{id}/plan", summary: "Goal or PRD to roadmap and tracker issues", scope: "send", body: S.Plan, tag: "Planning" },
  { method: "get", path: "/api/v1/portfolio", summary: "Cross-factory rollup", tag: "Planning" },
  { method: "get", path: "/api/v1/digest", summary: "Pending decisions per person", tag: "Planning" },
  { method: "get", path: "/api/v1/metrics", summary: "Factory metrics: PRs, autonomy, cycle time, cost, scores", scope: "read", tag: "Measure" },
  { method: "get", path: "/api/v1/metrics/raw", summary: "Raw runs, scores or work items", scope: "read", tag: "Measure" },
  { method: "get", path: "/api/v1/scores", summary: "Scores for a factory", scope: "read", tag: "Measure" },
  { method: "get", path: "/api/v1/factories/{id}/self-improvement", summary: "Proposals and unreviewed failures", scope: "read", tag: "Measure" },
  { method: "post", path: "/api/v1/factories/{id}/self-improvement/run", summary: "Run self-improvement now", scope: "definitions:write", tag: "Measure" },
  { method: "post", path: "/api/v1/proposals/{id}/approve", summary: "Approve a proposal (ships as a canary)", scope: "definitions:write", tag: "Measure" },
  { method: "post", path: "/api/v1/proposals/{id}/reject", summary: "Reject a proposal (kept as a negative example)", scope: "definitions:write", tag: "Measure" },
  { method: "get", path: "/api/v1/factories/{id}/benchmarks", summary: "Benchmark results and Pareto summary", scope: "read", tag: "Benchmarks" },
  { method: "post", path: "/api/v1/factories/{id}/benchmarks/{suite}/run", summary: "Run a benchmark suite", scope: "definitions:write", tag: "Benchmarks" },
  { method: "post", path: "/api/v1/factories/{id}/benchmarks/{suite}/router", summary: "Propose routing rules from results", scope: "definitions:write", tag: "Benchmarks" },
  { method: "get", path: "/api/v1/factories/{id}/memories", summary: "Factory memories", scope: "read", tag: "Memories and skills" },
  { method: "post", path: "/api/v1/factories/{id}/memories", summary: "Propose a memory", scope: "send", body: S.Memory, tag: "Memories and skills" },
  { method: "post", path: "/api/v1/memories/{id}/accept", summary: "Accept a memory into the definition", scope: "definitions:write", tag: "Memories and skills" },
  { method: "get", path: "/api/v1/skills", summary: "Org-wide skills catalog", tag: "Memories and skills" },
  { method: "post", path: "/api/v1/skills/publish", summary: "Publish a factory skill to the catalog", scope: "definitions:write", body: S.Publish, tag: "Memories and skills" },
  { method: "post", path: "/api/v1/skills/{id}/install", summary: "Install a catalog skill into a factory", scope: "definitions:write", body: S.Install, tag: "Memories and skills" },
  { method: "get", path: "/api/v1/audit", summary: "Audit log", scope: "admin", tag: "Admin" },
  { method: "get", path: "/api/v1/tokens", summary: "List API tokens", scope: "admin", tag: "Admin" },
  { method: "post", path: "/api/v1/tokens", summary: "Issue a scoped token", scope: "admin", body: S.Token, tag: "Admin" },
  { method: "put", path: "/api/v1/secrets/{name}", summary: "Set a managed secret", scope: "admin", tag: "Admin" },
  { method: "post", path: "/webhooks/github", summary: "GitHub webhook (X-Hub-Signature-256)", tag: "Webhooks" },
  { method: "post", path: "/webhooks/slack", summary: "Slack Events API (signing secret)", tag: "Webhooks" },
  { method: "post", path: "/webhooks/linear", summary: "Linear webhook (Linear-Signature)", tag: "Webhooks" },
  { method: "post", path: "/webhooks/jira", summary: "Jira webhook (?token=)", tag: "Webhooks" },
  { method: "post", path: "/webhooks/{factory}/{name}", summary: "A factory's custom webhook from webhooks/<name>.yaml", tag: "Webhooks" },
];

/** The API surface, used for the OpenAPI document and the generated API reference. */
export const ROUTES: Route[] = [...CORE, ...MODULES.flatMap((m) => m.routes)];

export function openApiDocument() {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const r of ROUTES) {
    const params = [...r.path.matchAll(/\{(\w+)\}/g)].map((m) => ({ name: m[1], in: "path", required: true, schema: { type: "string" } }));
    (paths[r.path] ??= {})[r.method] = {
      summary: r.summary,
      tags: [r.tag],
      ...(params.length ? { parameters: params } : {}),
      ...(r.scope ? { "x-kiln-scope": r.scope, security: [{ bearer: [] }] } : {}),
      ...(r.body ? { requestBody: { required: true, content: { "application/json": { schema: z.toJSONSchema(r.body, { io: "input", unrepresentable: "any" }) } } } } : {}),
      responses: { "200": { description: "OK" }, "400": { description: "Invalid request" }, "401": { description: "Missing token" }, "403": { description: "Token lacks the scope" } },
    };
  }
  return {
    openapi: "3.1.0",
    info: { title: "Kiln API", version: "1.0.0", description: "Self-hostable software factories. Tokens carry per-factory scopes." },
    components: { securitySchemes: { bearer: { type: "http", scheme: "bearer" } } },
    paths,
  };
}
