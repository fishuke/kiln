/**
 * The automation trigger catalogue: every provider, its events, and the filter keys each
 * (provider, event) pair accepts with the matcher grammar of each key.
 *
 * Matcher grammar:
 * - `string` / `int`: null | bare array (= in) | { in, not_in }
 * - `string_in` / `int_in`: null | bare array | { in }  (no exclusions)
 * - `alias` / `int_alias`: a bare list of names (or numbers) resolved to ids when the definition
 *   is applied; an alias and its canonical key are mutually exclusive
 * - `bots`: all | self | none (GitHub `skip_bots`, default all)
 * - `payload`: a structural pattern over a webhook body (see validatePayloadPattern)
 * - `webhook_ids`: exactly one webhook uid (or file webhook name)
 */

export type MatcherKind = "string" | "string_in" | "int" | "alias" | "int_alias" | "bots" | "payload" | "webhook_ids";
export type FilterSpec = Record<string, MatcherKind>;

const S = "string" as const;

const GH_PR_BASE: FilterSpec = {
  assignees: S,
  authors: S,
  baseBranches: S,
  base_branches: S,
  labels: S,
  paths: S,
  prNumbers: "int",
  pr_numbers: "int",
  repos: S,
  skip_bots: "bots",
};
const LINEAR_ISSUE: FilterSpec = {
  assignee_ids: S,
  creator_ids: S,
  labels: S,
  mentioned_user_ids: S,
  project_ids: S,
  projects: "alias",
  state_ids: S,
  states: "alias",
  team_ids: S,
  teams: "alias",
};
const SLACK_MESSAGE: FilterSpec = { channel_ids: S, channels: "alias", keywords: S, user_ids: S, users: "alias" };
const DISCORD_MESSAGE: FilterSpec = { guild_ids: S, channel_ids: S, user_ids: S, keywords: S };
const TEAMS_MESSAGE: FilterSpec = { team_ids: "string_in", channel_ids: "string_in", keywords: S, user_ids: S };
const ADO_PR: FilterSpec = { base_branches: S, repos: S, source_repos: S };
const ADO_WORK_ITEM: FilterSpec = { assignees: S, authors: S, labels: S, work_item_types: S };

export const TRIGGER_CATALOG = {
  azure_devops: {
    pull_request_closed: ADO_PR,
    pull_request_commented: ADO_PR,
    pull_request_created: ADO_PR,
    pull_request_merged: ADO_PR,
    pull_request_updated: ADO_PR,
    pull_request_mentioned: { mentioned: S, repos: S },
    push: { branches: S, repos: S },
    work_item_assigned: ADO_WORK_ITEM,
    work_item_created: ADO_WORK_ITEM,
    work_item_labeled: ADO_WORK_ITEM,
    work_item_mentioned: { mentioned: S },
  },
  bitbucket: {
    pull_request_created: { repos: S, base_branches: S, authors: S, keywords: S },
    pull_request_commented: { repos: S, authors: S, keywords: S, mentioned: S },
    push: { repos: S, branches: S },
  },
  discord: {
    app_mention: DISCORD_MESSAGE,
    slash_command: DISCORD_MESSAGE,
    message_posted: DISCORD_MESSAGE,
    reaction_added: { ...DISCORD_MESSAGE, emojis: S },
  },
  factory: {
    work_item_stage_changed: { stages: S },
  },
  github: {
    check_run_rerequested: { repos: S, skip_bots: "bots" },
    check_suite_rerequested: { repos: S, skip_bots: "bots" },
    check_suite_completed: { authors: S, branches: S, conclusions: S, labels: S, repos: S, skip_bots: "bots" },
    commit_status: { contexts: S, repos: S, skip_bots: "bots", states: S },
    issue_assigned: { assignees: S, authors: S, labels: S, repos: S, skip_bots: "bots" },
    pull_request_assigned: { assignees: S, authors: S, labels: S, repos: S, skip_bots: "bots" },
    issue_commented: { authors: S, keywords: S, labels: S, repos: S, skip_bots: "bots" },
    pull_request_commented: { authors: S, keywords: S, labels: S, repos: S, skip_bots: "bots" },
    issue_created: { assignees: S, authors: S, keywords: S, labels: S, repos: S, skip_bots: "bots" },
    issue_labeled: { assignees: S, authors: S, labels: S, repos: S, skip_bots: "bots" },
    issue_mentioned: { authors: S, keywords: S, labels: S, mentioned: S, repos: S, skip_bots: "bots" },
    pull_request_mentioned: { authors: S, keywords: S, labels: S, mentioned: S, repos: S, skip_bots: "bots" },
    pull_request_closed: GH_PR_BASE,
    pull_request_dequeued: GH_PR_BASE,
    pull_request_enqueued: GH_PR_BASE,
    pull_request_labeled: GH_PR_BASE,
    pull_request_merged: GH_PR_BASE,
    pull_request_synchronized: GH_PR_BASE,
    pull_request_opened: { ...GH_PR_BASE, keywords: S },
    pull_request_ready: { ...GH_PR_BASE, keywords: S },
    pull_request_reopened: { ...GH_PR_BASE, keywords: S },
    pull_request_review_requested: { authors: S, repos: S, reviewer_teams: S, reviewers: S, skip_bots: "bots" },
    pull_request_review_submitted: { authors: S, keywords: S, labels: S, mentioned: S, repos: S, review_states: S, skip_bots: "bots" },
    push: { branches: S, paths: S, repos: S, skip_bots: "bots" },
    workflow_run_completed: { authors: S, branches: S, conclusions: S, labels: S, repos: S, skip_bots: "bots", workflows: S },
  },
  gitlab: {
    bot_mentioned: { mentioned: S, repos: S },
    merge_request: { actions: S, base_branches: S, repos: S },
    push: { branches: S, repos: S },
  },
  jira: {
    agent_session_created: { keywords: S, labels: S, project_keys: S },
    issue_created: { labels: S, project_keys: S },
    issue_labeled: { labels: S, project_keys: S },
    status_changed: { project_keys: S, status_ids: S },
  },
  kiln: {},
  linear: {
    agent_session_created: { creator_ids: S, keywords: S, labels: S, project_ids: S, projects: "alias", team_ids: S, teams: "alias" },
    comment_created: {
      creator_ids: S,
      issue_ids: S,
      issues: "int_alias",
      labels: S,
      mentioned_user_ids: S,
      project_ids: S,
      projects: "alias",
      state_ids: S,
      states: "alias",
      team_ids: S,
      teams: "alias",
    },
    issue_assigned: LINEAR_ISSUE,
    issue_created: LINEAR_ISSUE,
    issue_labeled: LINEAR_ISSUE,
    issue_state_changed: LINEAR_ISSUE,
  },
  schedule: {
    cron_fired: { schedule_ids: "string_in" },
  },
  slack: {
    app_mention: SLACK_MESSAGE,
    message_dm: SLACK_MESSAGE,
    message_im: SLACK_MESSAGE,
    message_mpim: SLACK_MESSAGE,
    message_posted: SLACK_MESSAGE,
    member_joined_channel: { channel_ids: S, channels: "alias", user_ids: S, users: "alias" },
    reaction_added: { channel_ids: S, channels: "alias", emojis: S, itemUsers: "alias", item_user_ids: S, keywords: S, user_ids: S, users: "alias" },
  },
  teams: {
    app_mention: TEAMS_MESSAGE,
    message_posted: TEAMS_MESSAGE,
  },
  webhook: {
    received: { webhook_ids: "webhook_ids", payload: "payload" },
  },
} as const satisfies Record<string, Record<string, FilterSpec>>;

export type TriggerProviderName = keyof typeof TRIGGER_CATALOG;
export const TRIGGER_PROVIDERS = Object.keys(TRIGGER_CATALOG) as TriggerProviderName[];

/** Alias keys and the canonical id key they resolve to. */
export const ALIAS_KEYS: Record<string, string> = {
  teams: "team_ids",
  projects: "project_ids",
  states: "state_ids",
  issues: "issue_ids",
  channels: "channel_ids",
  users: "user_ids",
  itemUsers: "item_user_ids",
};

/** camelCase spellings accepted for compatibility; each is exclusive with its snake_case twin. */
export const SYNONYM_KEYS: Record<string, string> = { baseBranches: "base_branches", prNumbers: "pr_numbers" };

/** Keys the server fills in; a definition that sets them is rejected. */
const SERVER_MANAGED: Record<string, string[]> = {
  "gitlab/bot_mentioned": ["mentioned"],
  "schedule/cron_fired": ["schedule_ids"],
};

/** Default value of keys that have one, for display and matching. */
export const FILTER_DEFAULTS: Record<string, unknown> = { skip_bots: "all" };

export function filterSpecFor(provider: string, event: string): FilterSpec | undefined {
  const events = (TRIGGER_CATALOG as Record<string, Record<string, FilterSpec>>)[provider];
  return events?.[event];
}

export function eventsFor(provider: string): string[] {
  return Object.keys((TRIGGER_CATALOG as Record<string, Record<string, FilterSpec>>)[provider] ?? {});
}

// ---------------------------------------------------------------------------------------------
// Payload patterns (webhook `payload` filter)

export const PAYLOAD_LIMITS = { depth: 10, leaves: 64, values: 32 } as const;
const OPERATOR_KEYS = new Set(["in", "not_in", "exists"]);
type Scalar = string | number | boolean | null;

export function isScalar(v: unknown): v is Scalar {
  return v === null || ["string", "number", "boolean"].includes(typeof v);
}

/** An operator object has only in / not_in / exists keys (and at least one of them). */
export function isOperator(v: unknown): v is { in?: Scalar[]; not_in?: Scalar[]; exists?: boolean } {
  return typeof v === "object" && v !== null && !Array.isArray(v) && Object.keys(v).length > 0 && Object.keys(v).every((k) => OPERATOR_KEYS.has(k));
}

const sameScalar = (a: unknown, b: unknown) => a === b || (typeof a === "number" && typeof b === "number" && Number(a) === Number(b));

/** Returns problems with a payload pattern (empty when valid). Invalid patterns never match. */
export function validatePayloadPattern(pattern: unknown): string[] {
  const problems: string[] = [];
  let leaves = 0;
  const walk = (node: unknown, path: string, depth: number) => {
    if (depth > PAYLOAD_LIMITS.depth) {
      problems.push(`${path}: nested deeper than ${PAYLOAD_LIMITS.depth} levels`);
      return;
    }
    if (typeof node !== "object" || node === null || Array.isArray(node)) {
      problems.push(`${path || "payload"}: must be an object of fields`);
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      const p = path ? `${path}.${key}` : key;
      if (Array.isArray(value)) {
        leaves++;
        checkSet(value, `${p}`);
      } else if (isOperator(value)) {
        leaves++;
        if (value.in !== undefined) checkSet(value.in, `${p}.in`);
        if (value.not_in !== undefined) checkSet(value.not_in, `${p}.not_in`);
        if (value.exists !== undefined && typeof value.exists !== "boolean") problems.push(`${p}.exists: must be true or false`);
        if (Array.isArray(value.in) && Array.isArray(value.not_in)) {
          for (const v of value.in) if (value.not_in.some((x) => sameScalar(x, v))) problems.push(`${p}: ${JSON.stringify(v)} is in both in and not_in`);
        }
        if (value.exists === false && Array.isArray(value.in) && value.in.length > 0) problems.push(`${p}: exists: false cannot be combined with a non-empty in`);
      } else if (typeof value === "object" && value !== null) {
        walk(value, p, depth + 1);
      } else {
        problems.push(`${p}: use a list of values, an operator object {in, not_in, exists} or a nested object`);
      }
    }
  };
  const checkSet = (values: unknown, p: string) => {
    if (!Array.isArray(values)) {
      problems.push(`${p}: must be a list`);
      return;
    }
    if (values.length > PAYLOAD_LIMITS.values) problems.push(`${p}: more than ${PAYLOAD_LIMITS.values} values`);
    if (!values.every(isScalar)) problems.push(`${p}: values must be strings, numbers, booleans or null`);
  };
  walk(pattern, "", 1);
  if (leaves > PAYLOAD_LIMITS.leaves) problems.push(`payload: more than ${PAYLOAD_LIMITS.leaves} leaf fields`);
  return problems;
}

// ---------------------------------------------------------------------------------------------
// Matchers and filters

function checkMatcher(kind: MatcherKind, value: unknown, key: string): string[] {
  const isList = (v: unknown, item: (x: unknown) => boolean) => Array.isArray(v) && v.every(item);
  const str = (x: unknown) => typeof x === "string";
  const int = (x: unknown) => Number.isInteger(x);
  switch (kind) {
    case "string":
    case "int":
    case "string_in": {
      const item = kind === "int" ? int : str;
      const type = kind === "int" ? "integers" : "strings";
      if (value === null || value === undefined) return [];
      if (Array.isArray(value)) return isList(value, item) ? [] : [`${key}: values must be ${type}`];
      if (typeof value === "object") {
        const allowed = kind === "string_in" ? ["in"] : ["in", "not_in"];
        const extra = Object.keys(value).filter((k) => !allowed.includes(k));
        if (extra.length) return [`${key}: unknown operator ${extra.join(", ")}${kind === "string_in" ? " (this filter supports only in)" : ""}`];
        return Object.entries(value).flatMap(([op, v]) => (isList(v, item) ? [] : [`${key}.${op}: values must be ${type}`]));
      }
      if (kind !== "int" && typeof value === "string") return [];
      return [`${key}: use a list of ${type} or {in, not_in}`];
    }
    case "alias":
      return isList(value, (x) => typeof x === "string" && x.length > 0) ? [] : [`${key}: use a plain list of names`];
    case "int_alias":
      return isList(value, (x) => Number.isInteger(x) && (x as number) >= 1) ? [] : [`${key}: use a plain list of positive numbers`];
    case "bots":
      return ["all", "self", "none"].includes(String(value)) ? [] : [`${key}: use all, self or none`];
    case "payload":
      return validatePayloadPattern(value);
    case "webhook_ids": {
      const list = Array.isArray(value) ? value : typeof value === "object" && value !== null ? (value as { in?: unknown }).in : undefined;
      if (typeof value === "object" && value !== null && !Array.isArray(value) && Object.keys(value).some((k) => k !== "in")) return [`${key}: supports only in`];
      return Array.isArray(list) && list.length === 1 && typeof list[0] === "string" && list[0].length > 0 ? [] : [`${key}: name exactly one webhook`];
    }
  }
}

/** The values a matcher admits/excludes. A plain string counts as a one-element `in` list. */
export function matcherSets(value: unknown): { in?: unknown[]; not_in?: unknown[] } {
  if (value === null || value === undefined) return {};
  if (Array.isArray(value)) return { in: value };
  if (typeof value === "object") return value as { in?: unknown[]; not_in?: unknown[] };
  return { in: [value] };
}

export type TriggerLike = { provider: string; event: string; filter?: Record<string, unknown>; schedule?: { cron: string; name?: string } };

/**
 * Check one trigger against the catalogue. Returns problems as [path, message] pairs, where path
 * is relative to the trigger (e.g. ["filter", "labels"]).
 */
export function validateTrigger(t: TriggerLike): { path: (string | number)[]; message: string }[] {
  const out: { path: (string | number)[]; message: string }[] = [];
  const events = (TRIGGER_CATALOG as Record<string, Record<string, FilterSpec>>)[t.provider];
  if (!events) {
    out.push({ path: ["provider"], message: `unknown provider ${t.provider}; use one of ${TRIGGER_PROVIDERS.join(", ")}` });
    return out;
  }
  if (t.provider === "kiln") return out;
  const spec = events[t.event];
  if (!spec) {
    out.push({ path: ["event"], message: `${t.provider} has no event ${t.event}; use one of ${Object.keys(events).join(", ")}` });
    return out;
  }
  const isCron = t.provider === "schedule" && t.event === "cron_fired";
  if (t.schedule && !isCron) out.push({ path: ["schedule"], message: "schedule is only valid on schedule/cron_fired triggers" });
  if (isCron && !t.schedule) out.push({ path: ["schedule"], message: "schedule triggers need a schedule.cron" });
  const filter = { ...(t.filter ?? {}) };
  // Legacy: `filter.webhook: <name>` is the older spelling of webhook_ids.
  if (t.provider === "webhook" && "webhook" in filter) {
    if ("webhook_ids" in filter) out.push({ path: ["filter", "webhook"], message: "set webhook_ids or the legacy webhook key, not both" });
    filter.webhook_ids = [filter.webhook];
    delete filter.webhook;
  }
  if (t.provider === "webhook" && !("webhook_ids" in filter)) out.push({ path: ["filter", "webhook_ids"], message: "webhook triggers need filter.webhook_ids naming exactly one webhook" });
  const managed = SERVER_MANAGED[`${t.provider}/${t.event}`] ?? [];
  for (const [key, value] of Object.entries(filter)) {
    const path = ["filter", key];
    if (managed.includes(key)) {
      out.push({ path, message: `${key} is managed by the server and cannot be set in a definition` });
      continue;
    }
    const kind = spec[key];
    if (!kind) {
      out.push({ path, message: `${t.provider}/${t.event} has no filter ${key}; use ${Object.keys(spec).filter((k) => !managed.includes(k)).join(", ") || "no filters"}` });
      continue;
    }
    for (const message of checkMatcher(kind, value, key)) out.push({ path, message });
  }
  for (const [alias, canonical] of Object.entries({ ...ALIAS_KEYS, ...SYNONYM_KEYS })) {
    if (alias in filter && canonical in filter) out.push({ path: ["filter", alias], message: `set ${alias} or ${canonical}, not both` });
  }
  if (t.provider === "teams") {
    const teams = matcherSets(filter.team_ids).in;
    if (filter.team_ids !== undefined && filter.team_ids !== null && teams?.length !== 1) out.push({ path: ["filter", "team_ids"], message: "team_ids takes exactly one Microsoft Teams team id" });
    const channels = matcherSets(filter.channel_ids).in;
    if (filter.channel_ids !== undefined && filter.channel_ids !== null) {
      if (!channels?.length) out.push({ path: ["filter", "channel_ids"], message: "channel_ids needs at least one channel id" });
      for (const c of channels ?? []) if (!/^19:.+@thread\.(tacv2|skype)$/.test(String(c))) out.push({ path: ["filter", "channel_ids"], message: `${c} is not a Teams channel id (19:…@thread.tacv2)` });
    }
  }
  if (t.schedule) {
    const cron = t.schedule.cron;
    if (!/^\s*(@(annually|yearly|monthly|weekly|daily|midnight|hourly)|@every\s+\S+|(\S+\s+){4}\S+)\s*$/.test(cron) || /^(CRON_TZ|TZ)=/i.test(cron.trim())) {
      out.push({ path: ["schedule", "cron"], message: `${cron} is not a five-field cron or descriptor (@daily, @hourly, @every 5m); schedules are always UTC` });
    }
  }
  return out;
}

/** At most one unnamed schedule per automation, and schedule names are unique. */
export function validateSchedules(triggers: TriggerLike[]): { path: (string | number)[]; message: string }[] {
  const out: { path: (string | number)[]; message: string }[] = [];
  const seen = new Set<string>();
  let unnamed = 0;
  triggers.forEach((t, i) => {
    if (!t.schedule) return;
    const name = t.schedule.name;
    if (!name) unnamed++;
    if (!name && unnamed > 1) out.push({ path: [i, "schedule", "name"], message: "at most one schedule per automation may omit name" });
    if (name && seen.has(name)) out.push({ path: [i, "schedule", "name"], message: `schedule name ${name} is used twice` });
    if (name) seen.add(name);
  });
  return out;
}
