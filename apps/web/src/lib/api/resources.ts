import "server-only";
import { HARNESSES as HARNESS_CATALOG, MODELS } from "@/lib/agent-catalog";
import { api, safe } from "@/lib/kiln";

/** Pickers shared by the automation, scorer and benchmark editors. */
export type Resources = {
  agents: { name: string; agentType: string; model?: string; harness?: string }[];
  runners: string[];
  secrets: string[];
  mcpServers: { id: string; name: string }[];
  models: string[];
  harnesses: string[];
  routers: string[];
  repositories: string[];
  integrations: string[];
  defaultModel: string;
};

/** Every model the pickers offer (shared catalog, including Claude Fable 5.1 and Fable 5). */
export const FALLBACK_MODELS = MODELS.map((m) => m.id);
export const HARNESSES = HARNESS_CATALOG.map((h) => h.id as string);

export async function loadResources(factory: string, f?: Awaited<ReturnType<typeof api.factory>> | null): Promise<Resources> {
  const detail = f ?? (await safe(() => api.factory(factory), null));
  const [managed, legacy, mcps, models] = await Promise.all([
    safe(() => api.request<{ name: string }[]>("GET", "/api/v1/managed-secrets"), []),
    safe(() => api.secrets(), []),
    safe(() => api.request<{ servers: { id: string; name: string }[] }>("GET", "/api/v1/mcp-servers"), { servers: [] }),
    safe(() => api.request<{ id: string }[] | { models: { id: string }[] }>("GET", "/api/v1/models"), []),
  ]);
  const modelIds = (Array.isArray(models) ? models : models.models ?? []).map((m) => m.id);
  const agentModels = (detail?.agents ?? []).map((a) => a.harness.model).filter((m): m is string => Boolean(m));
  const scorerModels = Object.values(detail?.scorers ?? {}).map((s) => s.model);
  const def = detail?.definition as { agentDefaults?: { model?: string; harness?: { model?: string } }; repositories?: { owner: string; name: string }[]; integrations?: (string | { type: string })[] } | undefined;
  const defaultModel = def?.agentDefaults?.model ?? def?.agentDefaults?.harness?.model ?? agentModels[0] ?? FALLBACK_MODELS[1]!;
  return {
    agents: (detail?.agents ?? []).map((a) => ({ name: a.name, agentType: a.agentType, model: a.harness.model, harness: a.harness.type })),
    runners: Object.keys(detail?.runners ?? {}),
    secrets: [...new Set([...managed.map((s) => s.name), ...legacy])].sort(),
    mcpServers: mcps.servers ?? [],
    models: [...new Set([...modelIds, defaultModel, ...agentModels, ...scorerModels, ...FALLBACK_MODELS])],
    harnesses: HARNESSES,
    routers: Object.keys(detail?.routers ?? {}),
    repositories: (detail?.factory as { repositories?: { owner: string; name: string }[] } | undefined)?.repositories?.map((r) => `${r.owner}/${r.name}`) ?? def?.repositories?.map((r) => `${r.owner}/${r.name}`) ?? [],
    integrations: (def?.integrations ?? []).map((i) => (typeof i === "string" ? i : i.type)),
    defaultModel,
  };
}
