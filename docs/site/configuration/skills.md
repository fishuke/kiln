---
title: Skills
description: Give agents reusable know-how with SKILL.md files, shared across a factory or scoped to one agent, and share them between factories.
owner: docs
section: Factory configuration
---

A skill is a `SKILL.md` file with a short frontmatter and Markdown instructions that Kiln hands to agents at the start of each run.

## Where skills live

| Path | Who gets it |
| --- | --- |
| `skills/<skill>/SKILL.md` | Every agent in the factory |
| `agents/<agent>/skills/<skill>/SKILL.md` | Only that agent |

If an agent skill has the same name as a shared skill, validation warns that it shadows the shared one. An agent skill under an agent directory that has no `agent.md` is an error.

Other files in a skill directory, such as scripts or examples, are allowed in the tree but are not sent to agents. Only the `SKILL.md` body is.

## A skill file

```markdown
---
name: house-style
description: Named exports, zod at boundaries
owner: platform
version: "2"
---
Use named exports. Validate every external input with zod.
```

| Key | Required | Notes |
| --- | --- | --- |
| `name` | yes | |
| `description` | yes | Harnesses use it to decide when the skill applies. |
| `owner` | no | Shown in the skills catalog. |
| `version` | no | A string. Shown in the catalog and used when installing. |

## How agents receive skills

At the start of a run, Kiln writes each skill to the harness's skills folder in the repository working copy:

| Harness | Folder |
| --- | --- |
| Claude Code | `.claude/skills/<name>/SKILL.md` |
| Codex | `.agents/skills/<name>/SKILL.md` |
| OpenCode | `.opencode/skills/<name>/SKILL.md` |

The run's start state records the skill names, so a [replay](../measure-and-improve/replay-and-canary.md) uses the same set.

## Sharing skills between factories

Kiln keeps an org-wide catalog of skills. It lists every skill in every factory's applied tree, plus published skills, with owner, version, the factories that use it and a usage count. Usage goes up by one each time a run receives the skill.

- **Publish** a shared skill from a factory to make it a catalog listing. Publishing again bumps the version unless the skill sets its own `version`.
- **Install** a listing into another factory. For a factory with a [config repo](definitions-as-code.md#config-repos-on-github), Kiln opens a pull request that adds `skills/<name>/SKILL.md`, labeled `kiln:skills`. For a Kiln-managed factory, Kiln applies the change directly.

Installing is a definition change, so it goes through the same validation and review as any other.

## Memories

Memories are conventions and decisions a factory has learned, such as "Use named exports". They live in the definition tree as `memories/<slug>.md`:

```markdown
---
title: Use named exports
tags: [typescript]
author: implement
---
Learned while building "Add a logo".
```

How a memory gets there:

1. An agent proposes it by adding `memories: [{ "title": "...", "body": "..." }]` to its `.kiln/result.json`, or a person proposes one. A proposal with the same title as an existing one is not duplicated.
2. A person accepts or rejects it. Accepting a memory for a config-repo factory opens a pull request labeled `kiln:memory`. For a Kiln-managed factory, Kiln applies it directly.
3. On later work runs, Kiln ranks memories against the prompt and adds up to five of them to the agent's instructions under "Factory memories".

## Related pages

- [Factory agents](agents.md)
- [Definitions as code](definitions-as-code.md)
- [Harnesses](../infrastructure/harnesses.md)
- [Self-improvement](../measure-and-improve/self-improvement.md)
