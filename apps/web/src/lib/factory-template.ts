import type { CreateFactoryInput } from "@kiln/sdk-ts";
import { stringify } from "yaml";
import { AGENT_TEMPLATES, MODELS, type HarnessId } from "./agent-catalog";
import { writeFrontmatter } from "./frontmatter";

/** What the Create factory wizard collects. Pure data so the tree can be built and tested anywhere. */
export type WizardInput = {
  name: string;
  alias: string;
  description?: string;
  avatarKey?: string;
  forge: "github" | "gitlab" | "azure_devops" | "bitbucket" | null;
  repositories: { owner: string; name: string }[];
  /** Commands that clone and prepare the code when there is no supported code host. */
  setupCommands: string[];
  agents: ("triage" | "spec" | "implement" | "review")[];
  chat: { type: "slack" | "microsoft-teams" | "discord"; channels: string[] }[];
  tracker: { type: "linear" | "jira"; keys: string[] } | null;
  selfImprovement: boolean;
  preset: "quality" | "cost";
  models: Record<string, string>;
  automations: string[];
};

export type AutomationTemplate = { id: string; name: string; description: string; provider: string; requires?: string[] };

/** Built-in starter automations, used when `GET /api/v1/automation-templates` is not available. */
export const AUTOMATION_TEMPLATES: (AutomationTemplate & { triggers: Record<string, unknown>[]; prompt: string })[] = [
  { id: "linear-duplicates", name: "Check new Linear issues for duplicates", description: "Triage each new Linear issue and link likely duplicates.", provider: "linear", requires: ["linear"], triggers: [{ provider: "linear", event: "issue_created" }], prompt: "Check whether this new issue duplicates an existing one. If it does, link them and say so on the issue; do not start work." },
  { id: "stale-reviews", name: "Follow up on stale factory PR reviews", description: "Every weekday, nudge reviewers on factory PRs waiting more than two days.", provider: "schedule", triggers: [{ provider: "schedule", event: "cron_fired", schedule: { cron: "0 9 * * 1-5", name: "weekday mornings" } }], prompt: "Find open pull requests labeled factory:{{alias}} that have waited more than two days for review and remind the requested reviewers." },
  { id: "ci-failures", name: "Auto-fix CI failures", description: "When CI fails on a factory PR, the implement agent fixes it.", provider: "github", requires: ["github"], triggers: [{ provider: "github", event: "check_suite_completed", filter: { conclusions: ["failure"], labels: ["factory:{{alias}}"] } }], prompt: "CI failed on this pull request. Find the cause, fix it on the same branch and push." },
  { id: "flaky-tests", name: "Auto-fix flaky tests", description: "Weekly, find flaky tests from CI history and stabilize them.", provider: "schedule", triggers: [{ provider: "schedule", event: "cron_fired", schedule: { cron: "0 6 * * 1", name: "Monday mornings" } }], prompt: "Find tests that failed and then passed on retry in the last week. Fix the flakiest one and open a pull request." },
  { id: "github-issues", name: "Autofix new GitHub issues", description: "Issues labeled kiln-ready go through the full lifecycle.", provider: "github", requires: ["github"], triggers: [{ provider: "github", event: "issue_labeled", filter: { labels: ["kiln-ready"] } }], prompt: "Take this issue through the factory's standard lifecycle." },
  { id: "linear-issues", name: "Autofix new Linear issues", description: "Linear issues delegated to the factory agent start a work item.", provider: "linear", requires: ["linear"], triggers: [{ provider: "linear", event: "agent_session_created" }], prompt: "Take this issue through the factory's standard lifecycle." },
  { id: "pr-review", name: "Auto-review pull requests", description: "Review every new pull request and post findings.", provider: "github", requires: ["github"], triggers: [{ provider: "github", event: "pull_request_opened" }], prompt: "Review this pull request against its issue and the repository conventions. Post one review with your findings." },
  { id: "dependency-audit", name: "Audit dependencies", description: "Weekly dependency and vulnerability audit with an upgrade PR.", provider: "schedule", triggers: [{ provider: "schedule", event: "cron_fired", schedule: { cron: "0 7 * * 1", name: "weekly" } }], prompt: "Audit dependencies for known vulnerabilities and outdated majors. Open one pull request with safe upgrades and list the rest." },
  { id: "review-comments", name: "Autofix PR review comments", description: "Address review comments on factory PRs.", provider: "github", requires: ["github"], triggers: [{ provider: "github", event: "pull_request_review_submitted" }], prompt: "Address the review comments on the pull request; continue the existing work." },
];

export const MODEL_PRESETS: Record<WizardInput["preset"], Record<string, string>> = {
  quality: { foreman: "claude-opus-5-5", triage: "claude-sonnet-5-5", spec: "claude-opus-5-5", implement: "claude-opus-5-5", review: "gpt-6" },
  cost: { foreman: "claude-sonnet-5-5", triage: "claude-haiku-5-5", spec: "claude-sonnet-5-5", implement: "claude-sonnet-5-5", review: "gpt-6-mini" },
};

/**
 * The wizard input as `POST /api/v1/factories` takes it, or null when the API's wizard cannot express
 * it (no GitHub/GitLab repo, chat other than Slack, chosen channels, custom models, unknown agents):
 * then the caller builds the tree here and applies it.
 */
export function toCreateFactoryInput(input: WizardInput): CreateFactoryInput | null {
  const forge = input.forge;
  if ((forge !== "github" && forge !== "gitlab") || !input.repositories.length) return null;
  if (input.chat.some((c) => c.type !== "slack" || c.channels.length)) return null;
  const preset = MODEL_PRESETS[input.preset];
  if (["foreman", ...input.agents].some((a) => input.models[a] !== undefined && input.models[a] !== preset[a])) return null;
  return {
    name: input.name.trim(),
    alias: input.alias,
    ...(input.description ? { description: input.description } : {}),
    ...(input.avatarKey ? { avatar: input.avatarKey } : {}),
    repos: input.repositories.map((r) => ({ owner: r.owner, name: r.name, forge })),
    agents: { triage: input.agents.includes("triage"), spec: input.agents.includes("spec"), implement: input.agents.includes("implement"), review: input.agents.includes("review") },
    ...(input.chat.length ? { communications: { slack: true } } : {}),
    ...(input.tracker ? { tracker: { type: input.tracker.type, ...(input.tracker.keys.length ? { scopes: input.tracker.keys } : {}) } } : {}),
    costPreset: input.preset === "cost" ? "efficient" : "quality",
    selfImprovement: input.selfImprovement,
    automationTemplates: input.automations,
    ...(input.setupCommands.length ? { runner: { setupCommands: input.setupCommands } } : {}),
  };
}

const AGENT_TYPE: Record<string, string> = { foreman: "FOREMAN", triage: "TRIAGE", spec: "SPEC", implement: "IMPLEMENT", review: "REVIEW" };

const FOREMAN_PROMPT = `# Foreman

You are the orchestrator ("foreman") of the software factory. You accept work into the factory and keep it in motion; you delegate to subagents for triage, specs, implementation and review.

## Procedure

1. Addressing check. If a message is not for you, stop silently.
2. Triage when the cause or scope is unknown, a tracked issue is needed, or the request may duplicate existing work.
3. Ask whether a spec is needed when a person must resolve ambiguity. Implementation waits for spec approval.
4. Dispatch implementation, then one adversarial review. Send unambiguous findings back to implementation; bring ambiguous ones to a person.
5. Label the pull request factory:{{alias}}, link it on the issue and hand it to a person with its evidence. Never merge.
6. Complete the work only after a merge notification or a person's confirmation.

Acknowledge requests immediately, give short updates, and link every PR, issue and spec you mention.
`;

const SCORERS: { slug: string; name: string; description: string; agents: (enabled: string[]) => string[] }[] = [
  { slug: "verbosity", name: "Verbosity", description: "Whether the agent's written, text output was proportionate to the work.", agents: (a) => ["foreman", ...a] },
  { slug: "task-compliance", name: "Task Compliance", description: "Whether the agent fulfilled the mandate of its assigned factory role and did what the user or its orchestrating agent asked.", agents: (a) => ["foreman", ...a] },
  { slug: "procedure-compliance", name: "Procedure Compliance", description: "Whether the agent complied with the standing rules delivered through system context and followed through on the skills its situation called for.", agents: (a) => ["foreman", ...a] },
  { slug: "efficiency", name: "Efficiency", description: "Whether the agent worked directly toward its result, or wasted effort on redundant steps, avoidable rework, or unnecessary back-and-forth.", agents: (a) => ["foreman", ...a] },
  { slug: "code-quality", name: "Code Quality", description: "Whether the code, tests, and comments the agent produced are well-designed and consistent with the target repo's conventions.", agents: (a) => (a.includes("implement") ? ["implement"] : []) },
];

const harnessFor = (model: string): HarnessId => MODELS.find((m) => m.id === model)?.harnesses[0] ?? "claude-code";
const fill = (s: string, alias: string) => s.replaceAll("{{alias}}", alias);

/** Builds the full definition tree (factory.yaml, agents, runner, scorers, automations) for a new factory. */
export function buildFactoryTree(input: WizardInput): Record<string, string> {
  const tree: Record<string, string> = {};
  const integrations: unknown[] = [];
  if (input.forge === "github" || input.forge === "gitlab") integrations.push(input.forge);
  for (const c of input.chat) integrations.push(c.channels.length ? { type: c.type, [c.type]: c.type === "discord" ? { channelIds: c.channels } : { channels: c.channels } } : c.type);
  if (input.tracker) integrations.push(input.tracker.keys.length ? { type: input.tracker.type, [input.tracker.type]: input.tracker.type === "linear" ? { teams: input.tracker.keys } : { projectKeys: input.tracker.keys } } : input.tracker.type);

  const factory: Record<string, unknown> = {
    schemaVersion: "kiln/v1",
    name: input.name.trim(),
    alias: input.alias,
    ...(input.description?.trim() ? { description: input.description.trim() } : {}),
    ...(input.avatarKey ? { avatar: input.avatarKey } : {}),
    repositories: input.repositories.map((r) => ({ ...(input.forge && input.forge !== "github" ? { forge: input.forge } : {}), owner: r.owner, name: r.name })),
    integrations,
    agentDefaults: { harness: { type: "claude-code", model: input.models.foreman ?? MODEL_PRESETS[input.preset].foreman }, runner: "default" },
    ...(input.selfImprovement ? { selfImprovement: { failedRunThreshold: 10, reviewers: { type: "admins" } } } : {}),
  };
  tree["factory.yaml"] = stringify(factory, { lineWidth: 0 });

  tree["runners/default.yaml"] = stringify({
    description: "Default Linux runner",
    image: "node:22-bookworm",
    backend: "docker",
    setupCommands: input.setupCommands.length ? input.setupCommands : ["corepack enable || true"],
  });

  const agents = ["foreman", ...input.agents];
  for (const name of agents) {
    const type = AGENT_TYPE[name]!;
    const model = input.models[name] ?? MODEL_PRESETS[input.preset][name]!;
    const t = AGENT_TEMPLATES[type];
    const prompt = name === "foreman" ? fill(FOREMAN_PROMPT, input.alias) : t!.prompt;
    const description = name === "foreman" ? "Orchestrates the factory workflow and dispatches each gated step." : t!.description;
    tree[`agents/${name}/agent.md`] = writeFrontmatter({ agentType: type, description, harness: { type: harnessFor(model), model } }, prompt);
  }

  if (input.selfImprovement) {
    for (const s of SCORERS) {
      const scored = s.agents(input.agents);
      if (!scored.length) continue;
      tree[`scorers/${s.slug}/scorer.md`] = writeFrontmatter(
        {
          name: s.name,
          description: s.description,
          agents: scored,
          labels: [
            { value: "pass", score: 1, description: "Meets the bar" },
            { value: "fail", score: 0, description: "Falls short" },
          ],
          passingScore: 1,
          samplingRate: 25,
          model: input.preset === "cost" ? "claude-haiku-5-5" : "claude-sonnet-5-5",
          selfImprovement: true,
        },
        `${s.description}\n\nGrade the run and explain the label in one paragraph.\n`,
      );
    }
  }

  for (const id of input.automations) {
    const t = AUTOMATION_TEMPLATES.find((a) => a.id === id);
    if (!t) continue;
    const triggers = JSON.parse(fill(JSON.stringify(t.triggers), input.alias)) as Record<string, unknown>[];
    tree[`automations/${t.id}/automation.md`] = writeFrontmatter({ enabled: true, displayName: t.name, triggers }, `${fill(t.prompt, input.alias)}\n`);
  }
  return tree;
}

/** Which starter automations make sense for the chosen integrations. */
export function availableTemplates<T extends { requires?: string[] }>(templates: T[], have: string[]): T[] {
  return templates.filter((t) => !t.requires?.length || t.requires.every((r) => have.includes(r)));
}
