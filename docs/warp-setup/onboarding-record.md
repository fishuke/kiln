# Warp Factories: spec so far (captured 2026-10-20)

Status: onboarding finished (summary, then test-connections page). Factory "Kiln" is running. The "Enable learning" and "first task" steps were not used.

Source: https://platform.warp.dev (logged in as Mehmet Adem Kurşun). Screenshots in `/Users/MehmetK/www/kiln-warp-capture/screenshots/`.

## Onboarding flow (7 steps)

| Step | Page | What it asks | What we chose | Screenshot |
| --- | --- | --- | --- | --- |
| 1 | Connect your code hosts (`/onboarding/codeforge-setup`) | GitHub, GitLab, Azure DevOps, or skip and clone with custom setup commands | GitHub connected, org `fishuke` | 01, 02 |
| 2 | Set up your factory (`/onboarding/identity-setup`) | Repos, factory name, description, avatar | Repo `social-xp`, name `Kiln`, no description or avatar | 03, 04 |
| 3 | Configure your Factory agents (`/onboarding/agents`) | Foreman @-name; enable Triage, Spec, Code, Review | Foreman `@kiln`; all four agents on | 05 |
| 4 | Add your Factory to your team (`/onboarding/communication`) | Slack or Microsoft Teams | Skipped | 07 |
| 5 | Connect your issue trackers (`/onboarding/issue-tracker`) | Linear, Jira | Linear connected, team `Convozy`; Jira not connected | 08, 09 |
| 6 | Set up cost management (`/onboarding/agent-defaults`) | Self-improvement toggle; quality vs cost; model per agent | Self-improvement on; "Higher-quality outputs"; Foreman `gpt-6-sol (high)`, Triage `grok 4.6 (medium)`, Spec `gpt-6-sol (high)`, Code `gpt-6-sol (high)`, Review `gpt-5.6-terra (high)` | 10 |
| 7 | Set up your automations (`/onboarding/automations`) | Initial automation switches | See below | 11–15 |
| 8 | Summary, then test connections | Factory starts; first task optional | Summary shown; learning and first task not used | 16, 17 |

## Step 7 automations

On at Finish:
- Check new Linear issues for duplicates
- Follow up on stale Factory PR reviews

Switched off by us before Finish (default was on):
- Auto-fix CI failures (opens fix PRs after author go-ahead)
- Auto-fix flaky tests (opens fix PRs)

Off, under "View more suggestions":
- Autofix new GitHub issues (opens linked PRs)
- Autofix new Linear issues (opens linked change requests)
- Auto-review pull requests (reviews for correctness, security, maintainability, missing tests)
- Audit dependencies (submits upgrades)
- Autofix PR review comments (pushes fixes)

Decision taken: the two auto-fix defaults were turned off so the factory does not open PRs on social-xp unprompted. Suggestions stayed off.

## Concepts (from the Warp UI and onboarding copy)

- **Factory**: a team of agents for one product, attached to repos. "One factory per product."
- **Foreman**: the agent you address by `@name` (here `@kiln`). It orchestrates sub-agents.
- **Agents**: Triage (accepts work from Jira/Linear), Spec (writes and drives spec approval), Code (implements), Review (inspects PRs). Each can be enabled per factory.
- **Work flow**: "You @mention the foreman" or an issue assigned to the factory → foreman delegates → triage → spec (if needed) → code → review → PR ready to merge.
- **Self-improvement**: opens PRs to address failures. Uses usage.
- **Models**: per-agent model, with a quality vs cost choice.
- **Sidebar, factory level**: Dashboard, Agents, Automations, Runs, Self improvement, Scorers, Benchmarks, Settings.
- **Sidebar, global**: Runs, Environments, MCPs and apps, Secrets, Integrations, Factories.
- **Overview page**: autonomy %, merged PRs, cost per PR, PRs opened (existing factories shown: Mobile App Factory, Marketing Site Factory, Internal reporting Factory).

## Open items

- Kiln plan is in the repo at `docs/plan/PLAN.md`; not yet pasted into the Warp factory.
- Repo `fishuke/klin` does not exist on GitHub yet; the Warp factory is still attached to `social-xp`.
