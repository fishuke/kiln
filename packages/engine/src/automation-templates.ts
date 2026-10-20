import { stringify } from "yaml";
import { GITHUB_BOT_HANDLE } from "@kiln/integrations";

/**
 * Ready automation definition files: the defaults seeded when a tool is connected, and the
 * suggestions offered when a factory is set up. `{{alias}}`, `{{linearTeams}}` and
 * `{{jiraProjects}}` are filled in for a factory.
 */
export type AutomationTemplate = {
  id: string;
  title: string;
  description: string;
  category: "default" | "suggested";
  /** Connections this template needs. */
  requires: string[];
  files: Record<string, string>;
};

type Trigger = { provider: string; event: string; filter?: Record<string, unknown>; schedule?: { cron: string; name?: string } };

function file(name: string, fm: { displayName: string; agent?: string; triggers: Trigger[] }, prompt: string): Record<string, string> {
  return { [`automations/${name}/automation.md`]: `---\n${stringify(fm).trimEnd()}\n---\n${prompt.trim()}\n` };
}

const t = (id: string, title: string, description: string, category: AutomationTemplate["category"], requires: string[], triggers: Trigger[], prompt: string): AutomationTemplate => ({
  id,
  title,
  description,
  category,
  requires,
  files: file(id, { displayName: title, triggers }, prompt),
});

const LABEL = "factory:{{alias}}";

export const AUTOMATION_TEMPLATES: AutomationTemplate[] = [
  // Defaults seeded per connected tool
  t(
    "github-mentions",
    "GitHub mentions and assignments",
    `Work on issues and pull requests that mention @${GITHUB_BOT_HANDLE} or assign it, labeled ${LABEL}.`,
    "default",
    ["github"],
    [
      { provider: "github", event: "issue_mentioned", filter: { mentioned: [GITHUB_BOT_HANDLE], labels: [LABEL] } },
      { provider: "github", event: "pull_request_mentioned", filter: { mentioned: [GITHUB_BOT_HANDLE], labels: [LABEL] } },
      { provider: "github", event: "issue_assigned", filter: { assignees: [GITHUB_BOT_HANDLE], labels: [LABEL] } },
      { provider: "github", event: "pull_request_assigned", filter: { assignees: [GITHUB_BOT_HANDLE], labels: [LABEL] } },
    ],
    "Read the issue or pull request and the comment that mentioned you, then do what was asked. Reply in the same thread.",
  ),
  t("github-issue-labeled", "GitHub issue labeled", `Take issues labeled ${LABEL} through the factory.`, "default", ["github"], [{ provider: "github", event: "issue_labeled", filter: { labels: [LABEL] } }], "Take the labeled issue from triage to a reviewed pull request."),
  t("github-pr-labeled", "GitHub pull request labeled", `Pick up pull requests labeled ${LABEL}.`, "default", ["github"], [{ provider: "github", event: "pull_request_labeled", filter: { labels: [LABEL] } }], "Review the labeled pull request and finish what it needs."),
  t(
    "github-pr-review-submitted",
    "Review submitted on a factory PR",
    `Address review feedback on pull requests labeled ${LABEL}.`,
    "default",
    ["github"],
    [{ provider: "github", event: "pull_request_review_submitted", filter: { labels: [LABEL], review_states: ["changes_requested", "commented"] } }],
    "Address the review comments on the pull request and push the fixes to the same branch.",
  ),
  t(
    "github-pr-closed-or-merged",
    "PR closed or merged follow-up",
    "Follow up when a factory pull request is merged or closed: move linked tracker issues to done on merge, report on close.",
    "default",
    ["github"],
    [
      { provider: "github", event: "pull_request_merged", filter: { labels: [LABEL] } },
      { provider: "github", event: "pull_request_closed", filter: { labels: [LABEL] } },
    ],
    "If the pull request was merged, move linked Linear or Jira issues to Done. If it was closed without merging, post a short note on the linked issue.",
  ),
  t("gitlab-bot-mentions", "GitLab bot mentions", "Work on merge request comments that mention the factory's GitLab bot.", "default", ["gitlab"], [{ provider: "gitlab", event: "bot_mentioned" }], "Do what the comment asks on the merge request and reply in the same discussion."),
  t("ado-pr-mentions", "Azure DevOps PR mentions", "Work on pull request comments that mention the factory identity.", "default", ["azure_devops"], [{ provider: "azure_devops", event: "pull_request_mentioned" }], "Do what the comment asks on the pull request and reply in the thread."),
  t("ado-work-item-mentions", "Azure DevOps work item mentions", "Work on work items that mention the factory identity.", "default", ["azure_devops"], [{ provider: "azure_devops", event: "work_item_mentioned" }], "Read the work item and the mention, then do what was asked."),
  t("ado-work-item-assigned", "Azure DevOps work item assigned", "Work on work items assigned to the factory identity.", "default", ["azure_devops"], [{ provider: "azure_devops", event: "work_item_assigned" }], "Take the assigned work item from triage to a reviewed pull request."),
  t("jira-agent-sessions", "Jira agent sessions", "Start work when someone assigns or mentions the factory in the selected Jira projects.", "default", ["jira"], [{ provider: "jira", event: "agent_session_created", filter: { project_keys: ["{{jiraProjects}}"] } }], "Work on the Jira issue that assigned or mentioned you. Show progress in the session."),
  t("linear-agent-sessions", "Linear agent sessions", "Start work when someone assigns, mentions or delegates to the factory in the selected Linear teams.", "default", ["linear"], [{ provider: "linear", event: "agent_session_created", filter: { teams: ["{{linearTeams}}"] } }], "Work on the Linear issue in this agent session and keep the session updated."),
  t("slack-app-mentions", "Slack mentions", "Start work when someone mentions the factory's Slack app.", "default", ["slack"], [{ provider: "slack", event: "app_mention" }], "Do what the message asks; reply in the thread."),
  t("slack-dms", "Slack direct messages", "Start work from direct messages to the Slack app.", "default", ["slack"], [{ provider: "slack", event: "message_dm" }], "Do what the message asks; reply in the conversation."),
  t("teams-app-mentions", "Teams mentions", "Start work when someone mentions the bot in a connected Teams channel.", "default", ["microsoft-teams"], [{ provider: "teams", event: "app_mention" }], "Do what the message asks; reply in the thread."),
  t(
    "discord-requests",
    "Discord /kiln and mentions",
    "Start work from the /kiln slash command and from mentions of the bot.",
    "default",
    ["discord"],
    [
      { provider: "discord", event: "slash_command" },
      { provider: "discord", event: "app_mention" },
    ],
    "Do what the request asks; reply in the thread.",
  ),

  // Suggestions offered when a factory is set up
  t("linear-duplicate-check", "Check new Linear issues for duplicates", "When a Linear issue is created, look for existing issues that cover the same thing.", "suggested", ["linear"], [{ provider: "linear", event: "issue_created", filter: { teams: ["{{linearTeams}}"] } }], "Search open and recently closed issues for duplicates of this one. If you find one, comment with links and stop; do not change code."),
  t("stale-pr-review-follow-up", "Follow up on stale factory PR reviews", "Every weekday, nudge reviewers of factory pull requests that have waited more than two days.", "suggested", ["github"], [{ provider: "schedule", event: "cron_fired", schedule: { name: "weekday-mornings", cron: "0 8 * * 1-5" } }], `List open pull requests labeled ${LABEL} with no review for two days. Comment once on each, asking the requested reviewers to take a look. Do not change code.`),
  t("autofix-ci-failures", "Auto-fix CI failures", "When CI fails on the main branch, find the cause and open a fix.", "suggested", ["github"], [{ provider: "github", event: "workflow_run_completed", filter: { branches: ["main"], conclusions: ["failure"], skip_bots: "self" } }], "Read the failed workflow's logs, find the cause and open a pull request that fixes it. If the failure is outside the repository (an outage, an expired secret), report it instead."),
  t("autofix-flaky-tests", "Auto-fix flaky tests", "Weekly, find tests that failed and then passed on the same commit, and stabilize them.", "suggested", ["github"], [{ provider: "schedule", event: "cron_fired", schedule: { name: "weekly-flaky-tests", cron: "0 6 * * 1" } }], "Look at last week's CI runs for tests that failed and passed on the same commit. Fix the flakiest one with a pull request that explains the race or dependency you removed."),
  t("autofix-github-issues", "Autofix new GitHub issues", "Try to fix every new GitHub issue opened by a person.", "suggested", ["github"], [{ provider: "github", event: "issue_created", filter: { skip_bots: "all" } }], "Triage the new issue. If it is a clear, small fix, open a pull request; otherwise ask the questions you need in the issue."),
  t("autofix-linear-issues", "Autofix new Linear issues", "Try to fix every new Linear issue in the selected teams.", "suggested", ["linear"], [{ provider: "linear", event: "issue_created", filter: { teams: ["{{linearTeams}}"] } }], "Triage the new issue. If it is a clear, small fix, open a pull request; otherwise ask the questions you need in the issue."),
  t("auto-review-prs", "Auto-review pull requests", "Review every pull request opened or marked ready against main, except work in progress.", "suggested", ["github"], [{ provider: "github", event: "pull_request_opened", filter: { base_branches: ["main"], labels: { not_in: ["wip"] } } }, { provider: "github", event: "pull_request_ready", filter: { base_branches: ["main"] } }], "Review the pull request adversarially: correctness, tests, security and readability. Post one review with inline comments. Never approve or merge."),
  t("audit-dependencies", "Audit dependencies", "Every Monday, check dependencies for known vulnerabilities and outdated majors.", "suggested", ["github"], [{ provider: "schedule", event: "cron_fired", schedule: { name: "weekly-audit", cron: "0 9 * * 1" } }], "Run the package manager's audit and outdated checks. Open one pull request with safe upgrades and list the rest with their risk."),
  t("autofix-pr-review-comments", "Autofix PR review comments", "When a reviewer requests changes on a factory pull request, address the comments.", "suggested", ["github"], [{ provider: "github", event: "pull_request_review_submitted", filter: { labels: [LABEL], review_states: ["changes_requested"] } }], "Address every review comment with a commit on the same branch, then reply to each comment with what changed."),
];

/** Templates with placeholders filled for one factory. */
export function renderTemplates(vars: { alias: string; linearTeams?: string[]; jiraProjects?: string[] }, templates = AUTOMATION_TEMPLATES): AutomationTemplate[] {
  return templates.map((tpl) => ({
    ...tpl,
    files: Object.fromEntries(
      Object.entries(tpl.files).map(([path, src]) => {
        let out = src.replaceAll("{{alias}}", vars.alias);
        out = out.replace(/(\n\s*-\s*)"?\{\{linearTeams\}\}"?/g, (_m, lead: string) => (vars.linearTeams?.length ? vars.linearTeams.map((x) => `${lead}${x}`).join("") : `${lead}"{{linearTeams}}"`));
        out = out.replace(/(\n\s*-\s*)"?\{\{jiraProjects\}\}"?/g, (_m, lead: string) => (vars.jiraProjects?.length ? vars.jiraProjects.map((x) => `${lead}${x}`).join("") : `${lead}"{{jiraProjects}}"`));
        return [path, out];
      }),
    ),
  }));
}
