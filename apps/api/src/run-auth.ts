import type { ApiToken } from "@kiln/auth";
import type { Kiln, Run } from "@kiln/engine";

/** The run an agent's token belongs to. */
export type RunPrincipal = { runId: string; factory: string; agent: string; workItemId?: string; rootRunId: string };

/** Paths anyone may call without a token: schemas, validation and the error catalog. */
export function isPublicPath(path: string): boolean {
  return /^\/api\/v1\/(factory-files\/(schemas(\/.*)?|validate)|errors)$/.test(path);
}

/**
 * Agents call the API (and the Kiln MCP server) with their run token. It acts as `agent:<name>`
 * with read and send on its own factory only, and only on its own task and run tree: no
 * decisions, no definition writes, no other tasks.
 */
export function runTokenAuth(kiln: Kiln, raw: string | undefined): { token: ApiToken; principal: RunPrincipal } | undefined {
  if (!raw?.startsWith("krt_")) return undefined;
  const claims = kiln.secrets.verify(raw);
  if (!claims) return undefined;
  const run = kiln.runs.get(claims.runId);
  if (!run) return undefined;
  const principal: RunPrincipal = { runId: run.id, factory: run.factory, agent: run.agent, workItemId: run.workItemId, rootRunId: run.rootRunId ?? run.id };
  const token: ApiToken = {
    id: `run:${run.id}`,
    name: `run token for ${run.agent}`,
    subject: `agent:${run.agent}`,
    hash: "",
    grants: [
      { scope: "read", factory: run.factory },
      { scope: "send", factory: run.factory },
    ],
    createdAt: run.startedAt,
  };
  return { token, principal };
}

/** Whether a run belongs to the agent's own task or run tree. */
export function inOwnTree(kiln: Kiln, p: RunPrincipal, run: Run | undefined): boolean {
  if (!run || run.factory !== p.factory) return false;
  if (p.workItemId && run.workItemId === p.workItemId) return true;
  return (run.rootRunId ?? run.id) === p.rootRunId;
}

const ALLOWED: { method: string; path: RegExp; check?: "run" | "task" | "factory" }[] = [
  { method: "GET", path: /^\/api\/v1\/me$/ },
  { method: "POST", path: /^\/api\/v1\/guard$/ },
  { method: "GET", path: /^\/api\/v1\/factories\/([^/]+)$/, check: "factory" },
  { method: "GET", path: /^\/api\/v1\/factories\/([^/]+)\/(agents|files(\/.*)?)$/, check: "factory" },
  { method: "POST", path: /^\/api\/v1\/factories\/([^/]+)\/definition-changes$/, check: "factory" },
  { method: "POST", path: /^\/api\/v1\/factories\/([^/]+)\/memories$/, check: "factory" },
  { method: "GET", path: /^\/api\/v1\/runs\/([^/]+)(\/(events|timeline|conversation|transcript|scores|stream))?$/, check: "run" },
  { method: "POST", path: /^\/api\/v1\/runs\/([^/]+)\/(spawn|run-agents|followups|steer|interrupt|cancel|questions)$/, check: "run" },
  { method: "GET", path: /^\/api\/v1\/runs$/ },
  { method: "GET", path: /^\/api\/v1\/work-items\/([^/]+)$/, check: "task" },
  { method: "POST", path: /^\/api\/v1\/work-items\/([^/]+)\/messages$/, check: "task" },
  { method: "GET", path: /^\/api\/v1\/factories\/[^/]+\/tasks\/([^/]+)(\/outputs)?$/, check: "task" },
  { method: "POST", path: /^\/api\/v1\/factories\/[^/]+\/tasks\/([^/]+)\/complete$/, check: "task" },
  { method: "GET", path: /^\/api\/v1\/gates\/([^/]+)$/ },
  { method: "POST", path: /^\/api\/v1\/uploads$/ },
  { method: "GET", path: /^\/api\/v1\/files\/.+$/ },
];

/** Undefined when the agent may make the call; otherwise the reason it may not. */
export function agentMayCall(kiln: Kiln, p: RunPrincipal, method: string, path: string): string | undefined {
  for (const rule of ALLOWED) {
    if (rule.method !== method) continue;
    const m = rule.path.exec(path);
    if (!m) continue;
    const id = m[1] ? decodeURIComponent(m[1]) : undefined;
    if (rule.check === "factory" && id !== p.factory) return `run tokens only reach their own factory (${p.factory})`;
    if (rule.check === "run" && !inOwnTree(kiln, p, kiln.runs.get(id!))) return `run ${id} is not part of this agent's task`;
    if (rule.check === "task" && id !== p.workItemId) return `task ${id} is not this agent's task`;
    return undefined;
  }
  return `run tokens cannot call ${method} ${path}`;
}
