/** Suggested automations. The API serves the catalogue at /api/v1/automation-templates; this is the built-in fallback. */

export type TemplateCategory = "suggested" | "incidents" | "implementation" | "code-review" | "security";

export const TEMPLATE_CATEGORIES: { id: TemplateCategory; label: string }[] = [
  { id: "suggested", label: "Suggested" },
  { id: "incidents", label: "Incidents and triage" },
  { id: "implementation", label: "Implementation" },
  { id: "code-review", label: "Code review" },
  { id: "security", label: "Security and monitoring" },
];

export type AutomationTemplate = {
  slug: string;
  title: string;
  description: string;
  categories: TemplateCategory[];
  /** Icons shown as source › target. */
  source: string;
  target: string;
  triggers: { provider: string; event: string; filter?: Record<string, unknown>; schedule?: { cron: string } }[];
  /** Agent type the automation should target when the factory has one. */
  agentType?: string;
  prompt: string;
  /** Per code host variants (github is the default). */
  variants?: string[];
};

export const BUILTIN_TEMPLATES: AutomationTemplate[] = [
  {
    slug: "autofix-new-github-issues",
    title: "Autofix new GitHub issues",
    description: "Implement safe fixes for clear, reproducible issues and open linked pull requests.",
    categories: ["suggested", "implementation"],
    source: "github",
    target: "github",
    triggers: [{ provider: "github", event: "issue_created" }],
    agentType: "FOREMAN",
    prompt:
      "Read the new issue. If it describes a clear, reproducible problem with an obvious, low-risk fix, reproduce it, implement the smallest safe fix with a focused test, and open a pull request that links the issue. If the issue is unclear, needs a product decision, or the fix is risky, comment with what is missing and stop.",
  },
  {
    slug: "autofix-new-linear-issues",
    title: "Autofix new Linear issues",
    description: "Implement safe fixes for clear Linear issues and open linked change requests.",
    categories: ["suggested", "implementation"],
    source: "linear",
    target: "github",
    triggers: [{ provider: "linear", event: "issue_created" }],
    agentType: "FOREMAN",
    prompt:
      "Read the new Linear issue. When it is clear and the fix is small and safe, implement it with a focused test and open a pull request linked to the issue. Otherwise comment on the issue with the questions that block the work and leave it unchanged.",
  },
  {
    slug: "auto-review-pull-requests",
    title: "Auto-review pull requests",
    description: "Review pull requests for correctness, security, maintainability, and missing tests.",
    categories: ["suggested", "code-review"],
    source: "github",
    target: "github",
    triggers: [{ provider: "github", event: "pull_request_ready" }],
    agentType: "REVIEW",
    prompt:
      "Review the pull request or merge request that triggered this automation. Inspect the changed code and relevant surrounding code for correctness, security, maintainability, and missing focused tests. Follow the repository instructions and coding standards. Submit one review with inline comments for actionable findings only, and approve nothing: a person decides on the merge.",
  },
  {
    slug: "autofix-flaky-tests",
    title: "Auto-fix flaky tests",
    description: "Track down flaky tests and other CI failures behind merged PRs and open fix PRs.",
    categories: ["suggested", "implementation"],
    source: "github",
    target: "github",
    triggers: [{ provider: "github", event: "workflow_run_completed", filter: { branches: ["main"], conclusions: ["failure"], skip_bots: "self" } }],
    agentType: "IMPLEMENT",
    prompt:
      "A workflow failed on the default branch. Find the failing job, decide whether the failure is a flaky test or a real regression from a merged change, and open a focused pull request that fixes the root cause. Do not disable or skip tests to make them pass.",
  },
  {
    slug: "ask-before-fixing-ci",
    title: "Auto-fix CI failures",
    description: "Fix failing checks on pull requests after the author gives the go-ahead.",
    categories: ["suggested", "implementation"],
    source: "github",
    target: "github",
    triggers: [{ provider: "github", event: "check_suite_completed", filter: { conclusions: ["failure"] } }],
    agentType: "IMPLEMENT",
    prompt:
      "Checks failed on a pull request. Comment once with a short diagnosis and ask the author whether you should push a fix. Only after the author agrees, push the smallest fix to the pull request branch and reply with what changed.",
  },
  {
    slug: "audit-dependencies",
    title: "Audit dependencies",
    description: "Check dependencies for known vulnerabilities and submit safe, focused upgrades.",
    categories: ["suggested", "security"],
    source: "schedule",
    target: "github",
    triggers: [{ provider: "schedule", event: "cron_fired", schedule: { cron: "0 9 * * 1" } }],
    agentType: "IMPLEMENT",
    prompt:
      "Audit the repositories' dependencies for known vulnerabilities. For each finding with a safe patched version, open one focused pull request per ecosystem that upgrades it, runs the tests, and explains the advisory. List findings without a safe fix in a single issue.",
  },
  {
    slug: "autofix-pr-review-comments",
    title: "Autofix PR review comments",
    description: "Resolve inline review comments, run the tests, push the fixes, and reply on each thread.",
    categories: ["suggested", "implementation"],
    source: "github",
    target: "github",
    triggers: [{ provider: "github", event: "pull_request_review_submitted", filter: { review_states: ["changes_requested", "commented"] } }],
    agentType: "IMPLEMENT",
    prompt:
      "A review was submitted on a pull request this factory owns. Address each actionable inline comment, run the tests, push the fixes to the pull request branch, and reply on every thread with what changed or why no change was made.",
  },
  {
    slug: "triage-new-github-issues",
    title: "Triage new GitHub issues",
    description: "Classify new issues, find duplicates, apply existing labels, and identify missing details.",
    categories: ["suggested", "incidents"],
    source: "github",
    target: "github",
    triggers: [{ provider: "github", event: "issue_created" }],
    agentType: "TRIAGE",
    prompt:
      "Triage the new issue: classify it (bug, feature, question), search for duplicates, apply existing labels only, and comment with any missing details needed to act on it. Do not close issues or create new labels.",
  },
  {
    slug: "find-vulnerabilities",
    title: "Find vulnerabilities",
    description: "Review pull requests for exploitable security issues and flag only validated findings before merge.",
    categories: ["suggested", "security"],
    source: "github",
    target: "github",
    triggers: [{ provider: "github", event: "pull_request_opened" }],
    agentType: "REVIEW",
    prompt:
      "Review the pull request for exploitable security issues (injection, auth bypass, secrets, unsafe deserialization, SSRF, path traversal). Report only findings you validated against the code, with the attack path and a suggested fix, as one review.",
  },
  {
    slug: "weekly-linear-backlog-cleanup",
    title: "Review the weekly Linear backlog",
    description: "Find old or duplicate Linear issues for your team to review.",
    categories: ["incidents"],
    source: "schedule",
    target: "linear",
    triggers: [{ provider: "schedule", event: "cron_fired", schedule: { cron: "0 8 * * 1" } }],
    agentType: "TRIAGE",
    prompt: "Find Linear issues untouched for more than 60 days and likely duplicates. Post one summary comment per team listing them with a suggested action. Do not change issue state.",
  },
  {
    slug: "weekly-changelog",
    title: "Draft a weekly changelog",
    description: "Draft release notes from the past week’s merged changes.",
    categories: ["implementation"],
    source: "schedule",
    target: "github",
    triggers: [{ provider: "schedule", event: "cron_fired", schedule: { cron: "0 15 * * 5" } }],
    agentType: "FOREMAN",
    prompt: "Collect the pull requests merged in the past seven days and draft user-facing release notes grouped by area. Open a pull request that adds them to the changelog.",
  },
  {
    slug: "assign-pr-reviewers",
    title: "Assign PR reviewers",
    description: "Route pull requests to the smallest appropriate reviewer set.",
    categories: ["code-review"],
    source: "github",
    target: "github",
    triggers: [{ provider: "github", event: "pull_request_ready" }],
    agentType: "REVIEW",
    prompt: "Request review from the smallest set of people who own the changed code, using CODEOWNERS and recent history. Explain the choice in one short comment.",
  },
  {
    slug: "linear-duplicate-check",
    title: "Check new Linear issues for duplicates",
    description: "Search for existing issues that describe the same problem and link likely duplicates.",
    categories: ["incidents"],
    source: "linear",
    target: "linear",
    triggers: [{ provider: "linear", event: "issue_created" }],
    agentType: "TRIAGE",
    prompt:
      "Read the new Linear issue and search across visible teams for the same underlying problem or requested outcome. If credible matches exist, post one comment with at most five matches and a short rationale for human review. Do not change issue state or close issues.",
  },
  {
    slug: "stale-pr-review-follow-up",
    title: "Follow up on stale PR reviews",
    description: "Nudge reviewers on factory pull requests that have been quiet for days.",
    categories: ["code-review"],
    source: "schedule",
    target: "github",
    triggers: [{ provider: "schedule", event: "cron_fired", schedule: { cron: "0 9 * * 1" } }],
    agentType: "FOREMAN",
    prompt:
      "Inspect open pull requests owned by this factory that have been quiet for more than three days. Follow up once with the current reviewers in a PR comment, offering a refresher or a review pass. Do not merge or start new work.",
  },
  {
    slug: "nightly-factory-digest",
    title: "Nightly factory digest",
    description: "Post a nightly summary of factory activity, open decisions, and failures.",
    categories: ["incidents"],
    source: "schedule",
    target: "slack",
    triggers: [{ provider: "schedule", event: "cron_fired", schedule: { cron: "0 2 * * *" } }],
    agentType: "FOREMAN",
    prompt: "Summarize the last 24 hours of factory activity: merged and opened pull requests, runs that failed, and decisions waiting on people. Post it to the team channel in under 15 lines.",
  },
];

/** Normalize an API template (unknown shape) into a template, or null if unusable. */
export function normalizeTemplate(raw: unknown): AutomationTemplate | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const slug = String(o.slug ?? o.id ?? "");
  const title = String(o.title ?? o.name ?? "");
  if (!slug || !title) return null;
  const cats = Array.isArray(o.categories) ? (o.categories as string[]) : o.category ? [String(o.category)] : ["suggested"];
  return {
    slug,
    title,
    description: String(o.description ?? ""),
    categories: cats.filter((c): c is TemplateCategory => TEMPLATE_CATEGORIES.some((x) => x.id === c)),
    source: String(o.source ?? (Array.isArray(o.triggers) ? ((o.triggers[0] as { provider?: string })?.provider ?? "github") : "github")),
    target: String(o.target ?? "github"),
    triggers: Array.isArray(o.triggers) ? (o.triggers as AutomationTemplate["triggers"]) : [],
    agentType: o.agentType ? String(o.agentType) : undefined,
    prompt: String(o.prompt ?? ""),
    variants: Array.isArray(o.variants) ? (o.variants as string[]) : undefined,
  };
}
