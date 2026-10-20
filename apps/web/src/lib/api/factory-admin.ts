import "server-only";

/**
 * Raw fetchers for endpoints the SDK does not have yet (factory admin, platform registries, metrics).
 * Every call degrades to `null` when the endpoint is missing so pages render empty states.
 */
const base = () => (process.env.KILN_API_URL ?? "http://localhost:4000").replace(/\/$/, "");
const headers = (json = false): Record<string, string> => ({
  accept: "application/json",
  ...(json ? { "content-type": "application/json" } : {}),
  ...(process.env.KILN_TOKEN ? { authorization: `Bearer ${process.env.KILN_TOKEN}` } : {}),
});

export async function getJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${base()}${path}`, { headers: headers(), cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export type SendResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

export async function sendJson<T>(method: string, path: string, body?: unknown): Promise<SendResult<T>> {
  try {
    const res = await fetch(`${base()}${path}`, { method, headers: headers(body !== undefined), body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store" });
    const text = await res.text();
    const data = text ? (JSON.parse(text) as unknown) : undefined;
    if (!res.ok) return { ok: false, status: res.status, error: (data as { error?: string } | undefined)?.error ?? `${method} ${path} returned ${res.status}` };
    return { ok: true, data: data as T };
  } catch (e) {
    return { ok: false, status: 0, error: e instanceof Error ? e.message : String(e) };
  }
}

const unwrap = <T>(v: T[] | { items?: T[]; data?: T[] } | null): T[] => (Array.isArray(v) ? v : (v?.items ?? v?.data ?? []));

/* ---------- Platform registries ---------- */

export type Connection = { id: string; provider: string; name?: string; account?: string; status?: string; scopes?: Record<string, { id: string; name: string }[]> };
export type McpServer = { id?: string; name: string; description?: string; transport?: string; url?: string; command?: string; managed?: boolean };
export type TeamSecret = { name: string; description?: string; type?: string; scope?: string; updatedAt?: string };
export type Worker = { id: string; name?: string; status?: string; backend?: string; lastSeenAt?: string };
export type AutomationTemplate = { id: string; name: string; description: string; provider: string; requires?: string[]; agent?: string };
export type ChannelOption = { id: string; name: string };

export const listConnections = async () => unwrap(await getJson<Connection[] | { items: Connection[] }>("/api/v1/connections"));
export const listMcpServers = async () => unwrap(await getJson<McpServer[] | { items: McpServer[] }>("/api/v1/mcp-servers"));
export const listWorkers = async () => unwrap(await getJson<Worker[] | { items: Worker[] }>("/api/v1/workers"));
export const listAutomationTemplates = async () => unwrap(await getJson<AutomationTemplate[] | { items: AutomationTemplate[] }>("/api/v1/automation-templates"));

/** `GET /api/v1/secrets` returns names today and objects later. */
export async function listSecrets(): Promise<TeamSecret[]> {
  const raw = unwrap(await getJson<(string | TeamSecret)[] | { items: TeamSecret[] }>("/api/v1/secrets"));
  return raw.map((s) => (typeof s === "string" ? { name: s } : s));
}

/** Channels, teams or projects a connection exposes, e.g. `GET /api/v1/connections/:id/channels`. */
export const listConnectionOptions = async (id: string, kind: "channels" | "teams" | "projects" | "repositories" | "orgs") =>
  unwrap(await getJson<ChannelOption[] | { items: ChannelOption[] }>(`/api/v1/connections/${encodeURIComponent(id)}/${kind}`));

/* ---------- Factory admin ---------- */

/** True when the server has the per-file definition API (repo-backed factories can then be edited through PRs). */
export async function filesApiAvailable(factory: string): Promise<boolean> {
  try {
    const res = await fetch(`${base()}/api/v1/factories/${encodeURIComponent(factory)}/files/factory.yaml`, { headers: headers(), cache: "no-store" });
    return res.ok;
  } catch {
    return false;
  }
}

export const deleteFactory = (id: string) => sendJson<{ ok: true }>("DELETE", `/api/v1/factories/${encodeURIComponent(id)}`);
export const migrateFactoryToGithub = (id: string, input: { owner: string; name: string }) =>
  sendJson<{ repo: string; url?: string; pullRequest?: string }>("POST", `/api/v1/factories/${encodeURIComponent(id)}/migrate`, input);

export type CreateFactoryInput = {
  name: string;
  alias: string;
  description?: string;
  avatarKey?: string;
  forge: string | null;
  repositories: { forge: string; owner: string; name: string }[];
  agents: string[];
  integrations: { type: string; settings?: Record<string, unknown> }[];
  selfImprovement: boolean;
  modelPreset: "quality" | "cost";
  models: Record<string, string>;
  automations: string[];
};
export const createFactory = (input: CreateFactoryInput) => sendJson<{ id: string; factory?: string }>("POST", "/api/v1/factories", input);

/* ---------- Metrics (coming; shapes assumed) ---------- */

export type PerPrCost = {
  pr: { repo: string; number: number; url: string; title: string; state: "open" | "merged" | "closed" };
  creator?: string;
  source?: string;
  models?: { model: string; share: number }[];
  additions?: number;
  deletions?: number;
  files?: number;
  costUsd: number;
  size?: "S" | "M" | "L" | "XL";
  components?: string[];
};

export const topPrCosts = (factory: string, start: string, end: string) =>
  getJson<PerPrCost[] | { items: PerPrCost[] }>(`/api/v1/factories/${encodeURIComponent(factory)}/costs/per-pr/top?start_date=${start}&end_date=${end}&limit=20`).then((v) => (v ? unwrap(v) : null));
