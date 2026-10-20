import type { TestFilterResult } from "@kiln/sdk-ts";

export type FilterCheck = { name: string; passed: boolean; detail?: string };
/** What the Test filter dialog shows for one trigger of the saved automation. */
export type FilterTestView = { matched: boolean; paused: boolean; trigger?: string; checks: FilterCheck[] };

const show = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v));

/**
 * Maps `POST …/automations/:name/test-filter` to the dialog: the trigger at `index` (the one the
 * dialog opened from), else the first that matched, else the first. `paused` marks a trigger that
 * matches while the automation itself is disabled.
 */
export function filterTestView(r: TestFilterResult, index?: number): FilterTestView {
  const t = r.triggers.find((x) => x.index === index) ?? r.triggers.find((x) => x.wouldTrigger) ?? r.triggers[0];
  if (!t) return { matched: r.wouldTrigger, paused: false, checks: [] };
  return {
    matched: t.wouldTrigger,
    paused: t.wouldTrigger && !r.wouldTrigger,
    trigger: `${t.provider} ${t.event}`,
    checks: t.checks.map((c) => ({
      name: c.check,
      passed: c.ok,
      detail: c.reason ?? (c.ok || (c.expected === undefined && c.actual === undefined) ? undefined : `expected ${show(c.expected)}, got ${show(c.actual)}`),
    })),
  };
}
