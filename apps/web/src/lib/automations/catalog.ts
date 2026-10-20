/**
 * The automation trigger catalogue as the editor shows it: providers, their events (grouped and
 * labelled), and the filter keys each event accepts. Mirrors the schema's TRIGGER_CATALOG.
 */

export type ProviderId = "schedule" | "webhook" | "github" | "azure_devops" | "gitlab" | "bitbucket" | "linear" | "jira" | "slack" | "teams" | "discord" | "factory";

/**
 * - `string`: list or {in, not_in}
 * - `string_in`: list or {in}
 * - `int`: integers, list or {in, not_in}
 * - `alias`: plain list of names, resolved to ids on apply; paired with a canonical id key
 * - `int_alias`: plain list of numbers
 * - `bots`: all | self | none
 * - `payload`: JSON pattern
 * - `webhook_ids`: exactly one webhook
 */
export type MatcherKind = "string" | "string_in" | "int" | "alias" | "int_alias" | "bots" | "payload" | "webhook_ids";

/** How a filter row edits its values. */
export type Picker = "repos" | "branches" | "labels" | "users" | "free" | "globs" | "keywords" | "teams" | "projects" | "states" | "channels" | "options" | "numbers" | "stages" | "webhook" | "bots" | "payload";

export type FilterField = {
  /** Canonical key written to the definition. */
  key: string;
  label: string;
  kind: MatcherKind;
  picker: Picker;
  placeholder: string;
  /** Alternate key holding names that resolve to the canonical ids (teams → team_ids). */
  alias?: string;
  /** Legacy camelCase spelling accepted on read. */
  synonym?: string;
  options?: { value: string; label: string }[];
};

const F = (key: string, label: string, picker: Picker, placeholder: string, extra: Partial<FilterField> = {}): FilterField => ({ key, label, kind: "string", picker, placeholder, ...extra });

const repos = F("repos", "Repositories", "repos", "All repositories");
const skipBots: FilterField = {
  key: "skip_bots",
  label: "Skip bot events",
  kind: "bots",
  picker: "bots",
  placeholder: "All bots",
  options: [
    { value: "all", label: "All bots" },
    { value: "self", label: "Self (Kiln-owned bots)" },
    { value: "none", label: "None" },
  ],
};
const baseBranches = F("base_branches", "Base branches", "branches", "select branches", { synonym: "baseBranches" });
const branches = F("branches", "Branches", "branches", "select branches");
const paths = F("paths", "Paths", "globs", "add repository-relative globs");
const labels = F("labels", "Labels", "labels", "select labels");
const ghAuthors = F("authors", "Authors", "users", "select GitHub users");
const ghAssignees = F("assignees", "Assignees", "users", "select GitHub users");
const keywords = F("keywords", "Keywords", "keywords", "add keywords");
const mentioned = F("mentioned", "Mentioned", "users", "select users");
const prNumbers: FilterField = { key: "pr_numbers", synonym: "prNumbers", label: "PR numbers", kind: "int", picker: "numbers", placeholder: "add PR numbers" };
const conclusions = F("conclusions", "Conclusions", "options", "select conclusions", {
  options: ["success", "failure", "cancelled", "timed_out", "action_required", "neutral", "skipped", "stale"].map((v) => ({ value: v, label: v.replace("_", " ") })),
});

const GH_PR_BASE = [repos, skipBots, baseBranches, paths, labels, ghAuthors, ghAssignees, prNumbers];
const GH_PR_KW = [...GH_PR_BASE, keywords];

const linearTeams = F("team_ids", "Teams", "teams", "select teams", { alias: "teams" });
const linearProjects = F("project_ids", "Projects", "projects", "select projects", { alias: "projects" });
const linearStates = F("state_ids", "States", "states", "select states", { alias: "states" });
const linearAssignees = F("assignee_ids", "Assignees", "users", "select assignees");
const linearCreator = F("creator_ids", "Issue creator", "users", "anyone");
const linearMentioned = F("mentioned_user_ids", "Mentioned users", "users", "select users");
const LINEAR_ISSUE = [linearTeams, labels, linearProjects, linearStates, linearAssignees, linearCreator, linearMentioned];

const slackChannels = F("channel_ids", "Channels", "channels", "select channels", { alias: "channels" });
const slackUsers = F("user_ids", "Users", "users", "select users", { alias: "users" });
const SLACK_MESSAGE = [slackChannels, slackUsers, keywords];

const teamsTeam: FilterField = { key: "team_ids", label: "Team", kind: "string_in", picker: "free", placeholder: "Microsoft Teams team id" };
const teamsChannels: FilterField = { key: "channel_ids", label: "Channels", kind: "string_in", picker: "free", placeholder: "19:…@thread.tacv2" };
const TEAMS_MESSAGE = [teamsTeam, teamsChannels, keywords, F("user_ids", "Users", "users", "select users")];

const DISCORD_MESSAGE = [F("guild_ids", "Servers", "free", "add server ids"), F("channel_ids", "Channels", "free", "add channel ids"), F("user_ids", "Users", "free", "add user ids"), keywords];

const ADO_PR = [repos, baseBranches, F("source_repos", "Source repositories", "repos", "select repositories")];
const ADO_WI = [F("work_item_types", "Work item types", "free", "add work item types"), F("assignees", "Assignees", "users", "select users"), F("authors", "Authors", "users", "select users"), labels];

export type EventDef = { id: string; label: string; group?: string; filters: FilterField[]; /** shown in the Add trigger menu */ menu?: boolean };

export type ProviderDef = {
  id: ProviderId;
  label: string;
  /** Workspace integration that must be connected for the menu item to be active. */
  integration?: string;
  events: EventDef[];
};

const E = (id: string, label: string, filters: FilterField[], group?: string, menu = true): EventDef => ({ id, label, filters, group, menu });

export const PROVIDERS: ProviderDef[] = [
  { id: "schedule", label: "Scheduled", events: [E("cron_fired", "Scheduled", [])] },
  {
    id: "webhook",
    label: "Webhook",
    events: [
      E("received", "Webhook received", [
        { key: "webhook_ids", label: "Webhook", kind: "webhook_ids", picker: "webhook", placeholder: "select webhook" },
        { key: "payload", label: "Payload", kind: "payload", picker: "payload", placeholder: '{ "action": ["opened"] }' },
      ]),
    ],
  },
  {
    id: "github",
    label: "GitHub",
    integration: "github",
    events: [
      E("push", "Push to branch", [repos, skipBots, branches, paths], "Code"),
      E("issue_created", "Issue created", [repos, skipBots, labels, ghAuthors, ghAssignees, keywords], "Issues"),
      E("issue_assigned", "Issue assigned", [repos, skipBots, labels, ghAuthors, ghAssignees], "Issues"),
      E("issue_commented", "Issue commented", [repos, skipBots, labels, ghAuthors, keywords], "Issues"),
      E("issue_labeled", "Issue labeled", [repos, skipBots, labels, ghAuthors, ghAssignees], "Issues"),
      E("issue_mentioned", "Issue mentioned", [repos, skipBots, mentioned, labels, ghAuthors, keywords], "Issues"),
      E("pull_request_opened", "PR opened", GH_PR_KW, "Pull requests"),
      E("pull_request_ready", "PR ready for review", GH_PR_KW, "Pull requests"),
      E("pull_request_reopened", "PR reopened", GH_PR_KW, "Pull requests"),
      E("pull_request_synchronized", "PR updated with commits", GH_PR_BASE, "Pull requests"),
      E("pull_request_enqueued", "PR added to merge queue", GH_PR_BASE, "Pull requests"),
      E("pull_request_dequeued", "PR removed from merge queue", GH_PR_BASE, "Pull requests"),
      E("pull_request_assigned", "PR assigned", [repos, skipBots, labels, ghAuthors, ghAssignees], "Pull requests"),
      E("pull_request_commented", "PR commented", [repos, skipBots, labels, ghAuthors, keywords], "Pull requests"),
      E("pull_request_labeled", "PR labeled", GH_PR_BASE, "Pull requests"),
      E("pull_request_mentioned", "PR mentioned", [repos, skipBots, mentioned, labels, ghAuthors, keywords], "Pull requests"),
      E("pull_request_closed", "PR closed", GH_PR_BASE, "Pull requests"),
      E("pull_request_merged", "PR merged", GH_PR_BASE, "Pull requests"),
      E("pull_request_review_requested", "Review requested", [repos, skipBots, F("reviewers", "Reviewers", "users", "select GitHub users"), F("reviewer_teams", "Reviewer teams", "free", "add team slugs"), ghAuthors], "Reviews"),
      E(
        "pull_request_review_submitted",
        "Review submitted",
        [
          repos,
          skipBots,
          F("review_states", "Review states", "options", "select review states", {
            options: ["approved", "changes_requested", "commented"].map((v) => ({ value: v, label: v.replace("_", " ") })),
          }),
          labels,
          ghAuthors,
          mentioned,
          keywords,
        ],
        "Reviews",
      ),
      E("check_suite_completed", "Check suite completed", [repos, skipBots, conclusions, branches, labels, ghAuthors], "Checks & workflows"),
      E("workflow_run_completed", "Workflow run completed", [repos, skipBots, F("workflows", "Workflows", "free", "add workflow names"), conclusions, branches, labels, ghAuthors], "Checks & workflows"),
      E(
        "commit_status",
        "Commit status completed",
        [
          repos,
          skipBots,
          F("contexts", "Contexts", "free", "add status contexts"),
          F("states", "States", "options", "select states", { options: ["success", "failure", "error", "pending"].map((v) => ({ value: v, label: v })) }),
        ],
        "Checks & workflows",
      ),
      E("check_run_rerequested", "Check run re-requested", [repos, skipBots], "Checks & workflows"),
      E("check_suite_rerequested", "Check suite re-requested", [repos, skipBots], "Checks & workflows"),
    ],
  },
  {
    id: "azure_devops",
    label: "Azure DevOps",
    integration: "azure_devops",
    events: [
      E("pull_request_created", "PR created", ADO_PR, "Pull requests"),
      E("pull_request_updated", "PR updated", ADO_PR, "Pull requests"),
      E("pull_request_commented", "PR commented", ADO_PR, "Pull requests"),
      E("pull_request_mentioned", "PR mentioned", [repos, mentioned], "Pull requests"),
      E("pull_request_merged", "PR merged", ADO_PR, "Pull requests"),
      E("pull_request_closed", "PR closed", ADO_PR, "Pull requests"),
      E("push", "Push", [repos, branches], "Code", false),
      E("work_item_created", "Work item created", ADO_WI, "Work items"),
      E("work_item_assigned", "Work item assigned", ADO_WI, "Work items"),
      E("work_item_labeled", "Work item labeled", ADO_WI, "Work items"),
      E("work_item_mentioned", "Work item mentioned", [mentioned], "Work items"),
    ],
  },
  {
    id: "gitlab",
    label: "GitLab",
    integration: "gitlab",
    events: [
      E("merge_request", "Merge request", [
        repos,
        F("actions", "Actions", "options", "select actions", { options: ["open", "update", "reopen", "close", "merge", "approved"].map((v) => ({ value: v, label: v })) }),
        baseBranches,
      ]),
      E("bot_mentioned", "Bot mentioned", [repos]),
      E("push", "Push to branch", [repos, branches]),
    ],
  },
  {
    id: "bitbucket",
    label: "Bitbucket",
    integration: "bitbucket",
    events: [
      E("pull_request_created", "PR created", [repos, baseBranches, F("authors", "Authors", "users", "select users"), keywords]),
      E("pull_request_commented", "PR commented", [repos, F("authors", "Authors", "users", "select users"), mentioned, keywords]),
      E("push", "Push to branch", [repos, branches]),
    ],
  },
  {
    id: "linear",
    label: "Linear",
    integration: "linear",
    events: [
      E("issue_created", "Issue created", LINEAR_ISSUE),
      E("issue_labeled", "Issue labeled", LINEAR_ISSUE),
      E("issue_state_changed", "Issue state changed", LINEAR_ISSUE),
      E("issue_assigned", "Issue assigned", LINEAR_ISSUE),
      E("comment_created", "Comment created", [linearTeams, labels, linearProjects, linearStates, F("issue_ids", "Issues", "free", "add issue ids"), linearCreator, linearMentioned]),
      E("agent_session_created", "Agent session created", [linearTeams, labels, linearProjects, linearCreator, keywords]),
    ],
  },
  {
    id: "slack",
    label: "Slack",
    integration: "slack",
    events: [
      E("app_mention", "App mentioned", SLACK_MESSAGE),
      E("message_posted", "Message posted", SLACK_MESSAGE),
      E("message_dm", "Direct message", SLACK_MESSAGE),
      E("message_im", "Message in app DM", SLACK_MESSAGE, undefined, false),
      E("message_mpim", "Group DM message", SLACK_MESSAGE),
      E("reaction_added", "Reaction added", [slackChannels, F("emojis", "Emojis", "free", "add emoji names"), slackUsers, F("item_user_ids", "Message authors", "users", "select users", { alias: "itemUsers" }), keywords]),
      E("member_joined_channel", "Member joined channel", [slackChannels, slackUsers]),
    ],
  },
  { id: "teams", label: "Microsoft Teams", integration: "microsoft-teams", events: [E("app_mention", "App mentioned", TEAMS_MESSAGE), E("message_posted", "Message posted", TEAMS_MESSAGE)] },
  {
    id: "jira",
    label: "Jira",
    integration: "jira",
    events: [
      E("issue_created", "Issue created", [F("project_keys", "Projects", "projects", "select projects"), labels]),
      E("issue_labeled", "Issue labeled", [F("project_keys", "Projects", "projects", "select projects"), labels]),
      E("status_changed", "Status changed", [F("project_keys", "Projects", "projects", "select projects"), F("status_ids", "Statuses", "free", "add status ids")]),
      E("agent_session_created", "Agent session created", [F("project_keys", "Projects", "projects", "select projects"), labels, keywords]),
    ],
  },
  {
    id: "discord",
    label: "Discord",
    integration: "discord",
    events: [
      E("app_mention", "App mentioned", DISCORD_MESSAGE),
      E("message_posted", "Message posted", DISCORD_MESSAGE),
      E("slash_command", "Slash command", DISCORD_MESSAGE),
      E("reaction_added", "Reaction added", [...DISCORD_MESSAGE, F("emojis", "Emojis", "free", "add emoji names")]),
    ],
  },
  {
    id: "factory",
    label: "Factory",
    events: [E("work_item_stage_changed", "Stage changed", [F("stages", "Stages", "stages", "any stage")])],
  },
];

export const WORK_ITEM_STAGES = ["received", "triaging", "planning", "awaiting_spec", "building", "reviewing", "awaiting_preview", "handed_off", "complete", "blocked", "cancelled", "failed"];

const SHORT: Partial<Record<ProviderId, string>> = { schedule: "Schedule", teams: "Teams", azure_devops: "Azure DevOps" };

export function providerDef(id: string): ProviderDef | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

export function eventDef(provider: string, event: string): EventDef | undefined {
  return providerDef(provider)?.events.find((e) => e.id === event);
}

/** Every filter key (canonical, alias and synonym) an event accepts, mapped to its field. */
export function fieldIndex(provider: string, event: string): Map<string, FilterField> {
  const out = new Map<string, FilterField>();
  for (const f of eventDef(provider, event)?.filters ?? []) {
    out.set(f.key, f);
    if (f.alias) out.set(f.alias, f);
    if (f.synonym) out.set(f.synonym, f);
  }
  return out;
}

export function providerLabel(id: string): string {
  return SHORT[id as ProviderId] ?? providerDef(id)?.label ?? id;
}

/** "GitHub: PR closed" style label used in lists. */
export function triggerLabel(provider: string, event: string): string {
  const e = eventDef(provider, event);
  return `${providerLabel(provider)}: ${e?.label ?? event.replace(/_/g, " ")}`;
}

/** GitHub events grouped for the Add trigger submenu. */
export function groupedEvents(p: ProviderDef): { group?: string; events: EventDef[] }[] {
  const groups: { group?: string; events: EventDef[] }[] = [];
  for (const e of p.events.filter((x) => x.menu !== false)) {
    const g = groups.find((x) => x.group === e.group);
    if (g) g.events.push(e);
    else groups.push({ group: e.group, events: [e] });
  }
  return groups;
}

/** The first filters of a trigger render inline; the rest go under "More filters". */
export function inlineFilterKeys(provider: string): string[] {
  switch (provider) {
    case "github":
    case "gitlab":
    case "azure_devops":
    case "bitbucket":
      return ["repos"];
    case "linear":
      return ["team_ids", "labels"];
    case "jira":
      return ["project_keys"];
    case "slack":
      return ["channel_ids"];
    case "teams":
      return ["team_ids", "channel_ids"];
    case "factory":
      return ["stages"];
    case "webhook":
      return ["webhook_ids"];
    default:
      return [];
  }
}
