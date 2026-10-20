import "server-only";
import type { RunView } from "@kiln/sdk-ts";
import { BUILTIN_TEMPLATES, normalizeTemplate, type AutomationTemplate } from "@/lib/automations/templates";
import { api, safe } from "@/lib/kiln";

/** Suggested automations: the built-in catalogue plus the API templates, filled in for the factory. */
export async function automationTemplates(factory?: string): Promise<AutomationTemplate[]> {
  const [list, factories] = await Promise.all([safe(() => api.automationTemplates({ factory }), []), factory ? safe(() => api.factories(), []) : Promise.resolve([])]);
  // Templates carry a {{alias}} placeholder (labels such as factory:{{alias}}); fill it for this factory.
  const alias = factories.find((f) => f.id === factory || f.alias === factory)?.alias;
  const filled = alias ? (JSON.parse(JSON.stringify(list).replaceAll("{{alias}}", alias)) as typeof list) : list;
  const parsed = filled.map(normalizeTemplate).filter((t): t is AutomationTemplate => Boolean(t));
  // The built-in suggestions fill every category; the factory's own templates follow them.
  const builtin = new Set(BUILTIN_TEMPLATES.map((t) => t.slug));
  return [...BUILTIN_TEMPLATES, ...parsed.filter((t) => !builtin.has(t.slug))];
}

/**
 * Root runs of work items an automation started, newest first. The runs API cannot filter by
 * automation, so the work items' `source.automation` picks them.
 */
async function automationRunRows(factory: string): Promise<(RunView & { automation: string })[]> {
  const [items, page] = await Promise.all([
    safe(() => api.workItems({ factory }), []),
    safe(() => api.runsPage({ factory, limit: 500, sortBy: "created_at", sortOrder: "desc" }), null),
  ]);
  const byItem = new Map(items.filter((w) => w.source.automation).map((w) => [w.id, w.source.automation!]));
  const seen = new Set<string>();
  const out: (RunView & { automation: string })[] = [];
  // Oldest first so each work item keeps its first (root) run.
  for (const r of [...(page?.runs ?? [])].reverse()) {
    const automation = r.workItemId ? byItem.get(r.workItemId) : undefined;
    if (!automation || r.parentRunId || seen.has(r.workItemId!)) continue;
    seen.add(r.workItemId!);
    out.push({ ...r, automation });
  }
  return out.reverse();
}

export async function automationRuns(factory: string, name: string): Promise<RunView[]> {
  return (await automationRunRows(factory)).filter((r) => r.automation === name);
}

/** Most recent run start per automation name. */
export async function lastRuns(factory: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const r of await automationRunRows(factory)) if (!out[r.automation] || out[r.automation]! < r.startedAt) out[r.automation] = r.startedAt;
  return out;
}
