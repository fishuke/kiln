# Kiln factory definition

The `factory/` folder is a Warp Factories definition (schema `v1alpha1`). Warp reads it when it is stored in a GitHub repo the factory can see.

| Path | Purpose |
| --- | --- |
| `factory.yaml` | Name, alias `kiln`, target repo `fishuke/klin`, integrations, self-improvement, default model and runner. |
| `agents/foreman/agent.md` | Routes work items; never merges. |
| `agents/triage/agent.md` | Classifies and de-duplicates work. |
| `agents/spec/agent.md` | Writes specs; needs approval before code. |
| `agents/implement/agent.md` | Builds one approved task on a `kiln/*` branch. |
| `agents/review/agent.md` | Reviews PRs; advisory verdict. |
| `automations/kiln-ready/automation.md` | A GitHub issue labeled `kiln-ready` starts a work item. |
| `runners/linux-node.yaml` | Node 22 sandbox that runs pnpm install. |
| `scorers/acceptance-criteria/scorer.md` | Grades implement runs against acceptance criteria; feeds self-improvement. |

## Before it can be applied

- The repo `fishuke/klin` must exist on GitHub and be connected to the factory.
- `factory.yaml` uses `model: auto`. Check it against the current schema with the Warp validator before relying on it.
- Warp's own factory (`social-xp`, set up during onboarding) is not this definition. Re-point it or create a new factory from this repo.
