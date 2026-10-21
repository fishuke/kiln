import "server-only";
import { api, safe } from "@/lib/kiln";

/**
 * Platform registries and factory admin reads for the settings, agent and create pages. Every call
 * acts as the signed-in user and degrades to an empty value so pages render empty states.
 */

/* ---------- Platform registries ---------- */

/** A connected workspace provider. Connections are keyed by provider, so `id` is the provider. */
export type Connection = { id: string; provider: string; name?: string; account?: string; status: string };
export type TeamSecret = { name: string; description?: string; type?: string; scope?: string; updatedAt?: string };
export type ChannelOption = { id: string; name: string };
export type OptionKind = "channels" | "teams" | "projects" | "repositories" | "orgs";

export async function listConnections(): Promise<Connection[]> {
  const rows = await safe(() => api.connections(), []);
  return rows.flatMap((r) =>
    r.connection?.status === "connected"
      ? [{ id: r.provider, provider: r.provider, name: r.label, account: r.connection.account?.name, status: r.connection.status }]
      : [],
  );
}

export const listMcpServers = async () => (await safe(() => api.mcpServers(), null))?.servers ?? [];
export const listBuiltinMcps = async () => (await safe(() => api.mcpServers(), null))?.builtins ?? [];
export const listWorkers = async () => (await safe(() => api.workers(), null))?.workers ?? [];

/** Team secrets: managed ones with their metadata, plus names only from `GET /api/v1/secrets`. */
export async function listSecrets(): Promise<TeamSecret[]> {
  const [managed, names] = await Promise.all([safe(() => api.managedSecrets(), []), safe(() => api.secrets(), [])]);
  const out = new Map<string, TeamSecret>(
    managed.map((s) => [s.name, { name: s.name, description: s.description, type: s.type, scope: s.scope, updatedAt: s.updatedAt }]),
  );
  for (const n of names) if (!out.has(n)) out.set(n, { name: n });
  return [...out.values()];
}

/**
 * Picker options a connection offers: repositories and their owners from the forge, teams or
 * projects from the tracker, else the names the connection's directory knows (channels, teams, …).
 */
export async function connectionOptions(provider: string, kind: OptionKind): Promise<ChannelOption[]> {
  if (kind === "repositories" || kind === "orgs") {
    const r = await safe(() => api.forgeRepositories(), null);
    const full = (r?.repositories ?? []).filter((x) => x.forge === provider || r?.forge === provider).map((x) => `${x.owner}/${x.name}`);
    const names = kind === "orgs" ? [...new Set(full.map((n) => n.split("/")[0]!))] : full;
    return names.map((n) => ({ id: n, name: n }));
  }
  if (kind === "teams" || kind === "projects") {
    const t = await safe(() => api.trackerScopes(), null);
    if (t?.tracker === provider && t.scopes.length) return t.scopes;
  }
  const rows = await safe(() => api.connections(), []);
  const dir = rows.find((c) => c.provider === provider)?.connection?.directory?.[kind] ?? {};
  return Object.entries(dir).map(([name, id]) => ({ id, name }));
}

/* ---------- Factory admin ---------- */

/** True when the server has the per-file definition API (repo-backed factories can then be edited through PRs). */
export async function filesApiAvailable(factory: string): Promise<boolean> {
  return safe(async () => Boolean(await api.readFile(factory, "factory.yaml")), false);
}

/* ---------- Metrics ---------- */

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

type TopPr = { repo: string; number: number; url: string; title: string; state: string; dollars: { total: number }; additions?: number; deletions?: number };

/** Size bucket by changed lines, as the API's cost-by-size report counts them. */
export function prSize(additions?: number, deletions?: number): PerPrCost["size"] {
  if (additions === undefined) return undefined;
  const lines = additions + (deletions ?? 0);
  return lines < 100 ? "S" : lines < 500 ? "M" : lines < 1000 ? "L" : "XL";
}

/** The most expensive PRs in a date range (`YYYY-MM-DD`); null when the report is unavailable. */
export async function topPrCosts(factory: string, start: string, end: string): Promise<PerPrCost[] | null> {
  const r = await safe(() => api.topPrCosts(factory, { startDate: start, endDate: end, limit: 20 }), null);
  if (!r) return null;
  return ((r.prs ?? []) as TopPr[]).map((p) => ({
    pr: { repo: p.repo, number: p.number, url: p.url, title: p.title, state: p.state === "merged" || p.state === "closed" ? p.state : "open" },
    additions: p.additions,
    deletions: p.deletions,
    costUsd: p.dollars.total,
    size: prSize(p.additions, p.deletions),
  }));
}
