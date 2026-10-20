import { stringify } from "yaml";

export type AutomationTemplate = {
  id: string;
  title: string;
  description: string;
  /** Agent role that handles it; falls back to the foreman when the factory has no such agent. */
  role: "foreman" | "triage" | "implement" | "review";
  needs?: "github" | "linear" | "jira";
  triggers: Record<string, unknown>[];
  prompt: string;
};

/** Starter automations the factory wizard offers. */
export const AUTOMATION_TEMPLATES: AutomationTemplate[] = [
  {
    id: "linear-duplicate-check",
    title: "Check new Linear issues for duplicates",
    description: "When an issue is created in Linear, look for an existing issue that covers it.",
    role: "triage",
    needs: "linear",
    triggers: [{ provider: "linear", event: "issue_created" }],
    prompt: "A new issue was created. Search open and recently closed issues for one that covers the same problem. If you find one, report it as duplicateOf with a one-line reason; do not start any work.",
  },
  {
    id: "stale-pr-followup",
    title: "Follow up on stale factory PR reviews",
    description: "Every weekday morning, remind reviewers of factory pull requests that have waited more than two working days.",
    role: "foreman",
    needs: "github",
    triggers: [{ provider: "schedule", event: "cron_fired", schedule: { cron: "0 9 * * 1-5", name: "weekday mornings" } }],
    prompt: "List this factory's open pull requests that have waited more than two working days for a review. For each, post one short reminder in the thread or issue the work came from, naming the pull request with a link. Do not remind about the same pull request twice in one week.",
  },
  {
    id: "ci-autofix",
    title: "Auto-fix CI failures",
    description: "When CI fails on a factory branch, find the cause and push a fix.",
    role: "implement",
    needs: "github",
    triggers: [{ provider: "github", event: "check_suite_completed", filter: { conclusion: "failure" } }],
    prompt: "CI failed on this branch. Read the failing job's log, find the cause, fix it with a test when it is a real bug, and verify by running the same check locally. If the failure is unrelated to the branch (an outage, a flaky test), report that instead of changing code.",
  },
  {
    id: "flaky-test-autofix",
    title: "Auto-fix flaky tests",
    description: "Weekly, find tests that fail and then pass on retry, and stabilize them.",
    role: "implement",
    needs: "github",
    triggers: [{ provider: "schedule", event: "cron_fired", schedule: { cron: "0 6 * * 1", name: "Monday early" } }],
    prompt: "Find tests that failed and then passed on retry in the last week of CI runs on the default branch. Pick the most frequent one, find why it is flaky (timing, ordering, shared state, network), and fix the cause rather than adding retries. One test per run.",
  },
  {
    id: "github-issue-autofix",
    title: "Autofix new GitHub issues",
    description: "Take each new GitHub issue through the factory.",
    role: "foreman",
    needs: "github",
    triggers: [{ provider: "github", event: "issue_opened" }],
    prompt: "A new issue was opened. Take it through the factory's procedure.",
  },
  {
    id: "linear-issue-autofix",
    title: "Autofix new Linear issues",
    description: "Take each new Linear issue through the factory.",
    role: "foreman",
    needs: "linear",
    triggers: [{ provider: "linear", event: "issue_created" }],
    prompt: "A new issue was created in Linear. Take it through the factory's procedure.",
  },
  {
    id: "pr-auto-review",
    title: "Auto-review pull requests",
    description: "Review every new pull request and report findings.",
    role: "review",
    needs: "github",
    triggers: [{ provider: "github", event: "pull_request_opened" }],
    prompt: "A pull request was opened. Review it adversarially and report the verdict and findings. The foreman posts findings that need a person's decision.",
  },
  {
    id: "dependency-audit",
    title: "Audit dependencies",
    description: "Weekly, look for vulnerable or badly outdated dependencies and propose safe upgrades.",
    role: "implement",
    needs: "github",
    triggers: [{ provider: "schedule", event: "cron_fired", schedule: { cron: "0 8 * * 1", name: "Monday morning" } }],
    prompt: "Audit the repository's dependencies with its package manager's audit command. Upgrade only patch and minor versions that fix known vulnerabilities, run the tests, and report what you changed and what needs a person's decision (major upgrades).",
  },
  {
    id: "pr-comment-autofix",
    title: "Autofix PR review comments",
    description: "When a reviewer requests changes on a factory pull request, address them.",
    role: "implement",
    needs: "github",
    triggers: [{ provider: "github", event: "pull_request_review_submitted", filter: { state: "changes_requested" } }],
    prompt: "A reviewer requested changes. Address each comment on the same pull request and reply to it where it was made. Ask through the foreman when a comment needs a decision.",
  },
];

/** Automations every factory gets for the tools it connects. */
export function defaultAutomations(opts: { alias: string; github: boolean; slack: boolean; tracker?: "linear" | "jira"; trackerScopes?: string[] }): Record<string, { triggers: Record<string, unknown>[]; prompt: string }> {
  const label = `factory:${opts.alias}`;
  const out: Record<string, { triggers: Record<string, unknown>[]; prompt: string }> = {};
  if (opts.github) {
    out["github-issue-labeled"] = { triggers: [{ provider: "github", event: "issue_labeled", filter: { labels: [label] } }], prompt: "An issue was labeled for the factory. Take it through the factory's procedure." };
    out["github-pr-labeled"] = { triggers: [{ provider: "github", event: "pull_request_labeled", filter: { labels: [label] } }], prompt: "A pull request was labeled for the factory. Find what it needs (review, fixes, a rebase) and continue from there." };
    // Reviews and merges on factory pull requests continue their task without an automation.
  }
  if (opts.tracker === "linear") out["linear-agent-sessions"] = { triggers: [{ provider: "linear", event: "agent_session_created", ...(opts.trackerScopes?.length ? { filter: { team_ids: opts.trackerScopes } } : {}) }], prompt: "" };
  if (opts.tracker === "jira") out["jira-mentions"] = { triggers: [{ provider: "jira", event: "issue_mentioned" }], prompt: "" };
  if (opts.slack) out["slack-mentions"] = { triggers: [{ provider: "slack", event: "app_mention" }, { provider: "slack", event: "direct_message" }], prompt: "" };
  return out;
}

export function automationFile(front: Record<string, unknown>, prompt: string): string {
  return `---\n${stringify(front).trimEnd()}\n---\n${prompt}\n`;
}
