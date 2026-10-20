import "server-only";
import { loadResources } from "@/lib/api/resources";
import { listWebhooks } from "@/lib/api/webhooks";
import { api, safe } from "@/lib/kiln";

/** Everything the automation editor needs besides the automation itself. */
export async function loadEditorContext(factory: string) {
  const f = await safe(() => api.factory(factory), null);
  if (!f) return null;
  const [resources, hooks, integrations, def] = await Promise.all([loadResources(factory, f), listWebhooks(factory), safe(() => api.integrations(), null), safe(() => api.definition(factory), null)]);
  const connected = new Set<string>(resources.integrations);
  if (integrations) {
    for (const v of [integrations.forge, integrations.tracker, integrations.chat]) if (v && v !== "fake") connected.add(v === "teams" ? "microsoft-teams" : v);
    if (integrations.forge === "fake" || integrations.forge === "github") connected.add("github");
  }
  return {
    f,
    tree: def?.tree ?? {},
    resources,
    webhooks: hooks.webhooks.map((w) => ({ uid: w.id, name: w.name })),
    connected: [...connected],
    alias: f.factory.alias,
    repoBacked: Boolean(f.factory.definitionRepo),
  };
}
