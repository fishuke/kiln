---
title: Build your factory with your coding agent
description: Let Claude Code, Codex, Cursor, Copilot or any coding agent write a Kiln factory from your repository, merged pull requests, tracker and chat, then backtest it on your own history.
owner: docs
section: Guides
---

The Factory Architect is a set of instructions your coding agent follows to write a factory that fits how your team already works, and to test it on your last merged pull requests before you rely on it.

## Before you start

- The `kiln` CLI works in your repository (`npx @kiln/cli`, or `pnpm kiln` in this repository).
- The GitHub CLI is logged in (`gh auth login`), so the agent can read merged pull requests.
- Optional: your coding agent has MCP servers for your tracker (Linear, Jira) and chat (Slack). The agent asks before it reads them.

## 1. Install the instructions

```sh
kiln architect
```

This writes `.kiln/architect.md`, the agent-neutral instructions, and a native wrapper for each coding agent the repository already uses:

| Agent                     | Wrapper                                    | How to start                                 |
| ------------------------- | ------------------------------------------ | -------------------------------------------- |
| Claude Code               | `.claude/skills/kiln-architect/SKILL.md`   | `/kiln-architect`                            |
| Cursor                    | `.cursor/rules/kiln-architect.mdc`         | Ask the agent to use the kiln-architect rule |
| GitHub Copilot            | `.github/prompts/kiln-architect.prompt.md` | Run the kiln-architect prompt                |
| Codex, Gemini CLI, others | none needed                                | "Follow .kiln/architect.md"                  |

Pick wrappers with `--agent claude,cursor,copilot` or `--agent all`. Existing files are kept unless you pass `--force`. `kiln architect --print` writes the instructions to stdout for any other tool.

## 2. Let the agent work

The agent follows eight steps:

1. **Profile the repository** with `kiln scan --json`: languages, package manager, install, test, lint, typecheck and build commands, CI, agent instruction files, and MCP servers your dependencies suggest.
2. **Learn from merged pull requests**: typical size, recurring review asks, how tests are written, who reviews.
3. **Learn where work comes from**, after asking you: tracker projects, labels and states, Slack channels where requests arrive, error volume.
4. **Write the factory** under `kiln/`, starting from a template: factory.yaml, agents with your real commands, a conventions skill from your review history, automations for your real sources, gates, scorers, a runner and MCP servers.
5. **Backtest** with `kiln bench from-prs`.
6. **Validate** with `kiln validate kiln` until it prints ok.
7. **Explain** every choice and its evidence in `kiln/FACTORY.md`, with the secrets and connections you still need to add.
8. **Ask before applying**: it shows `kiln diff` and runs `kiln apply` or `kiln connect` only after you say yes.

The agent never copies secrets, customer data or private messages into files; it writes patterns.

## The backtest

```sh
kiln bench from-prs --repo acme/web --limit 20 --dir kiln
```

Reads your recent merged pull requests with the GitHub CLI and writes `kiln/benchmarks/backtest/`:

- One task per pull request, starting at the PR's base commit (`startingRepoRefs`).
- The prompt is the linked issue when the PR closes one, otherwise the PR's title and problem description. The diff is never included.
- Success criteria come from an "Acceptance criteria" section or checklist in the PR or its linked issue, otherwise from one default criterion.
- `criteriaVisibility: judge`, so the agent can't read the answer, and `referencePr` points at the merged PR.
- Tags `xs`, `s`, `m` or `l` by changed lines. Bot pull requests, reverts and PRs without a base commit are skipped and listed.

Run it with `kiln bench run backtest --factory <alias>` once the factory is applied, and compare models by adding configurations to `suite.yaml`.

## Related pages

- [Definitions as code](../configuration/definitions-as-code.md)
- [Benchmarks](../measure-and-improve/benchmarks.md)
- [Skills](../configuration/skills.md)
- [Automations](../configuration/automations.md)
- [CLI reference](../developer-tools/cli.md)
