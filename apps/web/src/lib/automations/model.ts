import { compact, parseFrontmatter, stringifyFrontmatter } from "@/lib/frontmatter";
import { fieldIndex, triggerLabel } from "./catalog";
import { describeCron } from "./cron";

export type Value = string | number;
/** One filter as the editor holds it: the key actually written plus its in / not_in sets. */
export type Matcher = { key: string; in?: Value[]; not_in?: Value[] };
export type BotPolicy = "all" | "self" | "none";

export type TriggerModel = {
  provider: string;
  event: string;
  /** Keyed by the field's canonical key. */
  filters: Record<string, Matcher>;
  skipBots?: BotPolicy;
  webhook?: string;
  payload?: unknown;
  schedule?: { cron: string; name?: string };
  /** Filter keys the catalogue does not know, kept verbatim. */
  unknown: Record<string, unknown>;
};

export const OVERRIDE_KEYS = ["model", "harness", "runner", "secrets", "mcpServers", "environmentId", "workerHost", "computerUseModel", "idleTimeoutMinutes", "required_repos"] as const;
export type OverrideKey = (typeof OVERRIDE_KEYS)[number];
export type Overrides = Partial<Record<OverrideKey, unknown>>;

export type AutomationModel = {
  /** Directory name under automations/; the automation's identity. */
  name: string;
  displayName?: string | null;
  enabled: boolean;
  agent?: string;
  prompt: string;
  triggers: TriggerModel[];
  overrides: Overrides;
  /** Front matter keys the editor does not manage, kept verbatim. */
  extra: Record<string, unknown>;
};

const KNOWN = new Set<string>(["enabled", "agent", "displayName", "triggers", ...OVERRIDE_KEYS]);

function asList(v: unknown): Value[] {
  if (v === null || v === undefined) return [];
  return (Array.isArray(v) ? v : [v]).filter((x): x is Value => typeof x === "string" || typeof x === "number");
}

/** Read one matcher value: a bare list means `in`, an object carries in / not_in, a string is a one-item list. */
export function readMatcher(key: string, value: unknown): Matcher | null {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value) || typeof value !== "object") return { key, in: asList(value) };
  const o = value as { in?: unknown; not_in?: unknown };
  const m: Matcher = { key };
  if (o.in !== undefined) m.in = asList(o.in);
  if (o.not_in !== undefined) m.not_in = asList(o.not_in);
  return m;
}

export function matcherIsEmpty(m: Matcher | undefined): boolean {
  return !m || (!(m.in?.length ?? 0) && !(m.not_in?.length ?? 0));
}

export function parseTrigger(raw: Record<string, unknown>): TriggerModel {
  const provider = String(raw.provider ?? "");
  const event = String(raw.event ?? "");
  const t: TriggerModel = { provider, event, filters: {}, unknown: {} };
  const sched = raw.schedule as { cron?: unknown; name?: unknown } | undefined;
  if (sched && typeof sched === "object") t.schedule = compact({ cron: String(sched.cron ?? ""), name: sched.name ? String(sched.name) : undefined }) as { cron: string; name?: string };
  const index = fieldIndex(provider, event);
  for (const [key, value] of Object.entries((raw.filter as Record<string, unknown> | null) ?? {})) {
    if (key === "skip_bots") {
      t.skipBots = String(value) as BotPolicy;
      continue;
    }
    if (provider === "webhook" && (key === "webhook_ids" || key === "webhook")) {
      const list = readMatcher(key, value)?.in ?? [];
      if (list[0] !== undefined) t.webhook = String(list[0]);
      continue;
    }
    if (provider === "webhook" && key === "payload") {
      t.payload = value;
      continue;
    }
    const field = index.get(key);
    const m = field ? readMatcher(key, value) : null;
    if (!field || !m) {
      if (!field) t.unknown[key] = value;
      continue;
    }
    t.filters[field.key] = m;
  }
  return t;
}

export function serializeTrigger(t: TriggerModel): Record<string, unknown> {
  const filter: Record<string, unknown> = {};
  if (t.provider === "webhook") {
    if (t.webhook) filter.webhook_ids = [t.webhook];
    if (t.payload !== undefined && t.payload !== null && !(typeof t.payload === "object" && Object.keys(t.payload as object).length === 0)) filter.payload = t.payload;
  }
  const index = fieldIndex(t.provider, t.event);
  for (const [canonical, m] of Object.entries(t.filters)) {
    if (matcherIsEmpty(m)) continue;
    const field = index.get(canonical);
    const inList = m.in?.length ? m.in : undefined;
    const notIn = m.not_in?.length ? m.not_in : undefined;
    const isAliasKey = field?.alias === m.key;
    if (notIn) {
      // Aliases take plain lists only; exclusions go on the canonical key.
      filter[isAliasKey ? canonical : m.key] = compact({ in: inList, not_in: notIn });
    } else {
      filter[m.key] = inList;
    }
  }
  if (t.skipBots) filter.skip_bots = t.skipBots;
  Object.assign(filter, t.unknown);
  return compact({
    provider: t.provider,
    event: t.event,
    filter: Object.keys(filter).length ? filter : undefined,
    schedule: t.schedule ? compact({ cron: t.schedule.cron, name: t.schedule.name || undefined }) : undefined,
  });
}

export function parseAutomation(name: string, md: string): AutomationModel {
  const { data, body } = parseFrontmatter(md);
  const overrides: Overrides = {};
  for (const k of OVERRIDE_KEYS) if (k in data) overrides[k] = data[k];
  const extra: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) if (!KNOWN.has(k)) extra[k] = v;
  return {
    name,
    displayName: (data.displayName as string | null | undefined) ?? undefined,
    enabled: data.enabled !== false,
    agent: data.agent ? String(data.agent) : undefined,
    prompt: body.replace(/^\n+/, "").replace(/\s+$/, ""),
    triggers: Array.isArray(data.triggers) ? (data.triggers as Record<string, unknown>[]).map(parseTrigger) : [],
    overrides,
    extra,
  };
}

export function serializeAutomation(a: AutomationModel): string {
  const data: Record<string, unknown> = {
    enabled: a.enabled ? undefined : false,
    agent: a.agent || undefined,
    displayName: a.displayName || undefined,
    triggers: a.triggers.map(serializeTrigger),
  };
  for (const k of OVERRIDE_KEYS) {
    const v = a.overrides[k];
    if (v === undefined || v === "" || (Array.isArray(v) && v.length === 0)) continue;
    data[k] = v;
  }
  Object.assign(data, a.extra);
  return stringifyFrontmatter(data, a.prompt);
}

export function newTrigger(provider: string, event: string, schedule?: string): TriggerModel {
  return { provider, event, filters: {}, unknown: {}, ...(schedule ? { schedule: { cron: schedule } } : {}) };
}

/** Comma-joined list summary, e.g. "GitHub: PR closed, GitHub: PR merged" or "Weekly on Mon at 9:00 AM". */
export function triggerSummary(triggers: { provider: string; event: string; schedule?: { cron: string } }[], offsetMinutes = 0): string {
  if (!triggers.length) return "No triggers";
  return triggers.map((t) => (t.provider === "schedule" && t.schedule ? describeCron(t.schedule.cron, offsetMinutes) : triggerLabel(t.provider, t.event))).join(", ");
}

/** Path of an automation's file in a definition tree (directory form preferred, flat form accepted). */
export function automationPath(tree: Record<string, string>, name: string): string | undefined {
  for (const p of [`automations/${name}/automation.md`, `automations/${name}.md`]) if (p in tree) return p;
  return undefined;
}

/** Automation names present in a definition tree. */
export function automationNames(tree: Record<string, string>): string[] {
  const names = new Set<string>();
  for (const p of Object.keys(tree)) {
    const m = /^automations\/([^/]+)\/automation\.md$/.exec(p) ?? /^automations\/([^/]+)\.md$/.exec(p);
    if (m) names.add(m[1]!);
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

export function hasScheduleTrigger(a: { triggers: { provider: string }[] }): boolean {
  return a.triggers.some((t) => t.provider === "schedule");
}
