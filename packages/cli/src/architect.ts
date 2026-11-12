// kiln architect: install the Factory Architect, instructions any coding agent can follow to write a Kiln factory
// from the team's real work (repo, merged PRs, tracker, chat) and backtest it on past pull requests.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type ArchitectAgent = "claude" | "cursor" | "copilot";
export const ARCHITECT_AGENTS: ArchitectAgent[] = ["claude", "cursor", "copilot"];

export const ARCHITECT_MD = `# Kiln Factory Architect

You are setting up a Kiln software factory for this repository: a team of agents that turns issues, chat requests and alerts into reviewed pull requests. Your job is to write a factory that fits how this team already works, from evidence, and to prove it on the team's own history before anyone relies on it.

## Ground rules

- **Evidence over guesses.** Every choice you make cites its source: a file, a pull request, a ticket or a message. If you have no evidence, keep the template's default and say so.
- **Ask first.** Ask the person before you read Slack or the tracker, and name the channels or projects you want to read. Read only what they agree to.
- **Summarize, don't copy.** Never copy secrets, tokens, customer data or private messages into any file. Write patterns ("bugs arrive in #support as screenshots"), not quotes.
- **Stay in your folder.** Write only under \`kiln/\` (and \`FACTORY.md\` inside it). Don't change application code, CI or settings.
- **Apply only with a yes.** Never run \`kiln apply\` or \`kiln connect\` without an explicit yes from the person.

If the \`kiln\` command is not installed, use \`npx @kiln/cli\` or the repository's own \`pnpm kiln\`.

## 1. Profile the repository

Run \`kiln scan --json\`. It reports languages, the package manager, install, test, lint, typecheck and build commands, the CI provider and its workflow files, agent instruction files, MCP servers the dependencies suggest (Sentry, Grafana, Datadog, Linear, Slack…) and a runner definition.

Then read what the scan points at: CLAUDE.md, AGENTS.md, CONTRIBUTING.md, the CI workflows (what must pass before merge) and CODEOWNERS.

## 2. Learn from merged pull requests

\`\`\`sh
gh pr list --state merged --limit 40 --json number,title,additions,deletions,labels,author,reviews,mergedAt
\`\`\`

Open 8 to 12 representative ones with \`gh pr view <n> --comments\`. Note:

- **Size**: how many are tiny (≤ 10 changed lines), small, medium, large. This sets \`skip_if\` for the spec gate.
- **Recurring review asks**: what reviewers keep requesting ("add a test", "use the logger", "no default exports"). These become a conventions skill and a scorer rubric.
- **Tests**: what kind of tests accompany a change, and where they live.
- **Reviewers**: who approves what. These become gate approvers and self-improvement reviewers.
- **Labels and titles**: conventions automations can filter on.

## 3. Learn where work comes from (ask before reading Slack or the tracker)

Ask: "May I read <tracker project> and <Slack channels> to learn where work comes from? I'll only summarize patterns." With a yes, use your MCP servers:

- **Tracker** (Linear, Jira or GitHub Issues): teams or projects, workflow states, labels and issue types, how many tickets have acceptance criteria, typical size. Tickets without criteria mean the spec gate matters.
- **Chat** (Slack, Teams, Discord): the channels where requests and bugs arrive, and how people ask.
- **Errors and alerts** (Sentry, Grafana, Datadog): how often fatal errors appear. This decides whether an incident automation is worth it.

## 4. Write the factory

Start from a template, then change it to match the evidence:

\`\`\`sh
kiln init kiln --template sdlc    # or single-repo, po-feature, incident
\`\`\`

Use \`kiln schema <kind>\` whenever you need the exact keys of a file.

| File | Write it from |
| --- | --- |
| \`factory.yaml\` | Name, alias, repositories, only the integrations the team uses, the person's preferred harness and model (Claude Code, Codex, OpenCode…), budgets that fit the PR sizes |
| \`agents/*/agent.md\` | Keep foreman, triage, spec, implement, verify and review. Put the repository's real install, test and lint commands in their instructions. Add a role only when the evidence shows a distinct kind of work |
| \`skills/*/SKILL.md\` | A conventions skill from CLAUDE.md, AGENTS.md and the recurring review asks; a testing skill from how tests are written here |
| \`pipelines/*.yaml\`, \`gates/*.yaml\` | \`skip_if\` from the size distribution; approvers from who actually reviews |
| \`automations/*\` | One per real source: the tracker label or state that means "ready", the Slack channel where requests arrive, a CI-failure fixer when main breaks often, a schedule (security sweep, flaky tests, dependency upgrades) when the history shows that chore |
| \`scorers/*\` | The acceptance-criteria scorer, plus one rubric from the recurring review asks |
| \`runners/*.yaml\` | The runner from \`kiln scan\`, with the install command as a setup command |
| MCP servers | The scan's suggestions and the tracker. Reference servers by name; never put keys in files. List the secrets the person must add in FACTORY.md |
| \`routers/*.yaml\` | Easy, medium and hard tasks to models the person has keys for |

## 5. Backtest on the team's own history

\`\`\`sh
kiln bench from-prs --repo <owner/name> --limit 20 --dir kiln
\`\`\`

This writes \`kiln/benchmarks/backtest\`: one task per recent merged pull request, starting at its base commit, judged against the PR's acceptance criteria with the merged PR as the reference. If the person wants to compare models or agents, add configurations to \`suite.yaml\` (up to six).

## 6. Validate until clean

Run \`kiln validate kiln\` and fix every error it reports (each one has a file and a line). Repeat until it prints \`ok\`.

## 7. Explain your choices

Write \`kiln/FACTORY.md\`:

- What the factory does, in three sentences.
- A table: **Choice | Evidence** (file, PR number, ticket or channel). One row per meaningful choice.
- What you left at the template default and why.
- Secrets and connections the person must add (model keys, GitHub App, tracker, Slack, MCP servers).
- Next steps: connect the integrations, run the backtest with \`kiln bench run backtest --factory <alias>\`, and look at the results before turning on automations.

## 8. Review, then apply only with a yes

Show the person what will change: \`kiln diff kiln --against applied\` when a Kiln server is configured (\`KILN_URL\`, \`KILN_TOKEN\`), otherwise the file list. Then ask. With a yes, run \`kiln apply kiln\`, or \`kiln connect <owner/repo> --dir kiln\` to keep the factory in Git.

## Done when

- [ ] \`kiln validate kiln\` prints ok
- [ ] \`kiln/benchmarks/backtest\` exists, or FACTORY.md says why not
- [ ] \`kiln/FACTORY.md\` explains every meaningful choice with its evidence
- [ ] No secrets, customer data or private messages are in any file
- [ ] The person said yes before anything was applied
`;

const POINTER =
  "Follow the Kiln Factory Architect instructions in `.kiln/architect.md` at the repository root, step by step. If that file is missing, run `kiln architect --print` and follow its output.";
const DESCRIPTION =
  "Write a Kiln software factory for this repository from its code, merged pull requests, tracker and chat, then backtest it on past pull requests. Use when asked to set up Kiln, onboard to Kiln, or create or improve a factory.";

export const ARCHITECT_FILES: Record<ArchitectAgent, { path: string; content: string }> = {
  claude: { path: ".claude/skills/kiln-architect/SKILL.md", content: `---\nname: kiln-architect\ndescription: ${DESCRIPTION}\n---\n\n${POINTER}\n` },
  cursor: { path: ".cursor/rules/kiln-architect.mdc", content: `---\ndescription: ${DESCRIPTION}\nalwaysApply: false\n---\n\n${POINTER}\n` },
  copilot: { path: ".github/prompts/kiln-architect.prompt.md", content: `---\nmode: agent\ndescription: ${DESCRIPTION}\n---\n\n${POINTER}\n` },
};

/** Agents the repository already uses, so we add their native wrapper. Claude Code when none are found. */
export function detectAgents(dir: string): ArchitectAgent[] {
  const has = (p: string) => existsSync(join(dir, p));
  const found: ArchitectAgent[] = [];
  if (has(".claude") || has("CLAUDE.md")) found.push("claude");
  if (has(".cursor") || has(".cursorrules")) found.push("cursor");
  if (has(".github/copilot-instructions.md") || has(".github/prompts")) found.push("copilot");
  return found.length ? found : ["claude"];
}

export function installArchitect(dir: string, opts: { agents?: ArchitectAgent[]; force?: boolean } = {}) {
  const agents = opts.agents ?? detectAgents(dir);
  const files = [{ path: ".kiln/architect.md", content: ARCHITECT_MD }, ...agents.map((a) => ARCHITECT_FILES[a])];
  const written: string[] = [],
    kept: string[] = [];
  for (const f of files) {
    const full = join(dir, f.path);
    if (existsSync(full) && !opts.force) {
      kept.push(f.path);
      continue;
    }
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, f.content);
    written.push(f.path);
  }
  return { agents, written, kept };
}

export function parseAgents(value: string | undefined): ArchitectAgent[] | undefined {
  if (!value) return undefined;
  if (value === "all") return [...ARCHITECT_AGENTS];
  const list = value
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const bad = list.filter((a) => !ARCHITECT_AGENTS.includes(a as ArchitectAgent));
  if (bad.length)
    throw new Error(`unknown agent ${bad.join(", ")}: use ${ARCHITECT_AGENTS.join(", ")} or all (Codex, Gemini CLI and others read .kiln/architect.md)`);
  return list as ArchitectAgent[];
}
