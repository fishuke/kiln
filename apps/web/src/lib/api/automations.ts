import "server-only";
import type { Run } from "@kiln/sdk-ts";
import { BUILTIN_TEMPLATES, normalizeTemplate, type AutomationTemplate } from "@/lib/automations/templates";
import { api, safe } from "@/lib/kiln";

const f = (id: string) => `/api/v1/factories/${encodeURIComponent(id)}`;

/** Suggested automations from the API, or the built-in catalogue. */
export async function automationTemplates(): Promise<AutomationTemplate[]> {
  const raw = await safe(() => api.request<unknown>("GET", "/api/v1/automation-templates"), null);
  const list = Array.isArray(raw) ? raw : raw && typeof raw === "object" && Array.isArray((raw as { templates?: unknown[] }).templates) ? (raw as { templates: unknown[] }).templates : null;
  const parsed = (list ?? []).map(normalizeTemplate).filter((t): t is AutomationTemplate => Boolean(t));
  return parsed.length ? parsed : BUILTIN_TEMPLATES;
}

export type AutomationRun = Run & { automation?: string; source?: string; title?: string };

/** Runs an automation started. Uses the runs list filters; rows that name another automation are dropped. */
export async function automationRuns(factory: string, name: string): Promise<AutomationRun[]> {
  const q = new URLSearchParams({ factory, source: "automation", automation: name, limit: "100" });
  const rows = await safe(() => api.request<AutomationRun[]>("GET", `/api/v1/runs?${q}`), []);
  return rows.filter((r) => r.automation === name || r.source === `automation:${name}`);
}

/** Most recent run start per automation name. */
export async function lastRuns(factory: string): Promise<Record<string, string>> {
  const q = new URLSearchParams({ factory, source: "automation", limit: "200" });
  const rows = await safe(() => api.request<AutomationRun[]>("GET", `/api/v1/runs?${q}`), []);
  const out: Record<string, string> = {};
  for (const r of rows) {
    const name = r.automation ?? (r.source?.startsWith("automation:") ? r.source.slice(11) : undefined);
    if (name && (!out[name] || out[name]! < r.startedAt)) out[name] = r.startedAt;
  }
  return out;
}

export type FilterTestResult = { matched: boolean; checks: { name: string; passed: boolean; detail?: string }[]; deliveryId?: string };

export function testFilter(factory: string, name: string, body: { trigger: Record<string, unknown>; deliveryId?: string }) {
  return api.request<FilterTestResult>("POST", `${f(factory)}/automations/${encodeURIComponent(name)}/test-filter`, body);
}

export function runAutomation(factory: string, name: string) {
  return api.request<{ runId?: string; workItemId?: string }>("POST", `${f(factory)}/automations/${encodeURIComponent(name)}/run`);
}
