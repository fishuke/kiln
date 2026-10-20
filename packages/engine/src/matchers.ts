import type { IncomingEvent } from "@kiln/integrations";
import { ALIAS_KEYS, filterSpecFor, isOperator, isScalar, matcherSets, SYNONYM_KEYS, validatePayloadPattern, type TriggerLike } from "@kiln/schema";

/** One filter check, as shown by "Test filter". */
export type CheckOutcome = { check: string; ok: boolean; expected?: unknown; actual?: unknown; reason?: string };
export type TriggerEvaluation = { ok: boolean; checks: CheckOutcome[] };

/** Ids that alias lists (teams, channels, …) resolved to when the definition was applied, keyed `<key>:<name>`. */
export type AliasMap = Record<string, string[]>;

/** Kiln work-item states grouped into the task stages automations filter on. */
export const STAGE_OF_STATE: Record<string, string> = {
  received: "TRIAGE",
  triaging: "TRIAGE",
  planning: "SPEC",
  awaiting_spec: "SPEC",
  building: "IMPLEMENT",
  awaiting_preview: "IMPLEMENT",
  reviewing: "REVIEW",
  handed_off: "REVIEW",
  complete: "COMPLETE",
  cancelled: "CANCELLED",
  failed: "CANCELLED",
};

/**
 * Where each filter key reads from in a normalized event. Keys not listed read the event field
 * with the same name. Each field may be a scalar or a list.
 */
const FIELD_OF: Record<string, string> = {
  authors: "author",
  assignees: "assignees",
  base_branches: "base",
  branches: "branch",
  pr_numbers: "number",
  conclusions: "conclusion",
  workflows: "workflow",
  review_states: "review_state",
  states: "state",
  contexts: "context",
  actions: "action",
  status_ids: "status_id",
  emojis: "emoji",
  schedule_ids: "schedule_id",
  work_item_types: "work_item_type",
  source_repos: "source_repo",
};

/** For alias keys without a resolved id map, fall back to the names the provider sent. */
const NAME_FIELD_OF: Record<string, string> = {
  teams: "team_names",
  projects: "project_names",
  states: "state_names",
  issues: "issue_numbers",
  channels: "channel_names",
  users: "user_names",
  itemUsers: "item_user_names",
};

const GLOB_KEYS = new Set(["paths", "branches", "base_branches"]);
const lower = (v: unknown) => String(v).toLowerCase();
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]);

export function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === "*" && glob[i + 1] === "*") {
      re += ".*";
      i++;
      if (glob[i + 1] === "/") i++;
    } else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`, "i");
}

function valueMatches(key: string, want: unknown, have: unknown[]): boolean {
  if (key === "keywords") {
    const text = have.map(lower).join("\n");
    return text.includes(lower(want));
  }
  if (GLOB_KEYS.has(key) && typeof want === "string" && /[*?]/.test(want)) {
    const re = globToRegExp(want);
    return have.some((h) => re.test(String(h)));
  }
  if (typeof want === "number") return have.some((h) => Number(h) === want);
  return have.some((h) => lower(h) === lower(want));
}

/** Evaluate a `{in, not_in}` / bare-list matcher. Empty or null matchers impose nothing. */
export function matchValues(key: string, matcher: unknown, have: unknown[]): boolean {
  const { in: inList, not_in: notIn } = matcherSets(matcher);
  if (inList && inList.length && !inList.some((w) => valueMatches(key, w, have))) return false;
  if (notIn && notIn.some((w) => valueMatches(key, w, have))) return false;
  return true;
}

// ---------------------------------------------------------------------------------------------
// Webhook payload patterns

const eq = (a: unknown, b: unknown) => a === b || (typeof a === "number" && typeof b === "number" && a === b);

function leafMatches(op: { in?: unknown[]; not_in?: unknown[]; exists?: boolean }, actual: unknown, present: boolean): boolean {
  if (op.exists === true && !present) return false;
  if (op.exists === false && present) return false;
  const values = Array.isArray(actual) ? actual.filter(isScalar) : present ? [actual] : [];
  if (op.in && op.in.length) {
    if (!present) return false;
    if (!op.in.some((w) => values.some((v) => eq(v, w)))) return false;
  }
  if (op.not_in && op.not_in.length && present && op.not_in.some((w) => values.some((v) => eq(v, w)))) return false;
  return true;
}

function patternMatches(pattern: Record<string, unknown>, node: unknown): boolean {
  // Arrays of objects: any element may satisfy the whole pattern at this level.
  if (Array.isArray(node)) return node.some((el) => typeof el === "object" && el !== null && patternMatches(pattern, el));
  if (typeof node !== "object" || node === null) return false;
  const obj = node as Record<string, unknown>;
  for (const [key, want] of Object.entries(pattern)) {
    const present = Object.prototype.hasOwnProperty.call(obj, key) && obj[key] !== undefined;
    const actual = obj[key];
    if (Array.isArray(want)) {
      if (!leafMatches({ in: want }, actual, present)) return false;
    } else if (isOperator(want)) {
      if (!leafMatches(want as { in?: unknown[]; not_in?: unknown[]; exists?: boolean }, actual, present)) return false;
    } else if (typeof want === "object" && want !== null) {
      if (!present || !patternMatches(want as Record<string, unknown>, actual)) return false;
    } else return false;
  }
  return true;
}

/** Match a webhook body against a payload pattern. Invalid patterns fail closed. */
export function matchPayload(pattern: unknown, payload: unknown): boolean {
  if (pattern === undefined || pattern === null) return true;
  if (validatePayloadPattern(pattern).length) return false;
  return patternMatches(pattern as Record<string, unknown>, payload);
}

// ---------------------------------------------------------------------------------------------
// Triggers

export type EvaluateContext = {
  /** Resolved ids for alias keys in this trigger's automation (from apply time). */
  aliases?: AliasMap;
};

/**
 * Evaluate one trigger against one event and report every check. Unknown events and providers
 * do not match; filters that the event cannot satisfy fail closed.
 */
export function evaluateTrigger(t: TriggerLike, event: IncomingEvent, ctx: EvaluateContext = {}): TriggerEvaluation {
  const checks: CheckOutcome[] = [];
  const add = (c: CheckOutcome) => {
    checks.push(c);
    return c.ok;
  };
  add({ check: "provider", ok: t.provider === event.provider, expected: t.provider, actual: event.provider });
  add({ check: "event", ok: t.event === event.event, expected: t.event, actual: event.event });
  if (checks.some((c) => !c.ok)) return { ok: false, checks };

  const d = event.data as Record<string, unknown>;
  const filter: Record<string, unknown> = { ...(t.filter ?? {}) };
  if (t.provider === "webhook" && "webhook" in filter) {
    filter.webhook_ids = [filter.webhook];
    delete filter.webhook;
  }
  const spec = filterSpecFor(t.provider, t.event) ?? {};

  // Bots: GitHub defaults to skipping every bot; Kiln's own activity never triggers by default anywhere.
  const policy = String(filter.skip_bots ?? (t.provider === "github" ? "all" : "self"));
  if (d.authorIsBot || d.authorIsSelf) {
    const skipped = policy === "all" ? Boolean(d.authorIsBot || d.authorIsSelf) : policy === "self" ? Boolean(d.authorIsSelf) : false;
    add({ check: "skip_bots", ok: !skipped, expected: policy, actual: d.authorIsSelf ? "self" : "bot", reason: skipped ? "events from this bot are skipped" : undefined });
  }

  for (const [rawKey, matcher] of Object.entries(filter)) {
    if (rawKey === "skip_bots") continue;
    if (matcher === null || matcher === undefined) continue;
    const key = SYNONYM_KEYS[rawKey] ?? rawKey;
    const kind = spec[rawKey];
    if (kind === "payload") {
      const valid = validatePayloadPattern(matcher);
      add({ check: "payload", ok: valid.length === 0 && matchPayload(matcher, d.payload), expected: matcher, reason: valid.length ? `invalid pattern: ${valid[0]}` : undefined });
      continue;
    }
    if (ALIAS_KEYS[key]) {
      const canonical = ALIAS_KEYS[key]!;
      const names = list(matcher);
      const resolved = names.flatMap((n) => ctx.aliases?.[`${key}:${n}`] ?? []);
      const ok = resolved.length
        ? matchValues(canonical, resolved, list(d[canonical]))
        : matchValues(key, names, list(d[NAME_FIELD_OF[key]!]));
      add({ check: rawKey, ok, expected: names, actual: resolved.length ? d[canonical] : d[NAME_FIELD_OF[key]!] });
      continue;
    }
    if (key === "keywords") {
      const text = [d.title, d.body, d.text].filter((x) => typeof x === "string");
      add({ check: rawKey, ok: matchValues("keywords", matcher, text), expected: matcher });
      continue;
    }
    if (key === "stages") {
      const have = list(d.stages ?? (d.to ? [d.to, STAGE_OF_STATE[String(d.to)]] : []));
      add({ check: rawKey, ok: matchValues(key, matcher, have), expected: matcher, actual: have });
      continue;
    }
    const field = FIELD_OF[key] ?? key;
    const have = list(d[field]);
    add({ check: rawKey, ok: matchValues(key, matcher, have), expected: matcher, actual: d[field] });
  }
  return { ok: checks.every((c) => c.ok), checks };
}
