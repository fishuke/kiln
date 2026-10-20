---
title: CLI reference
description: Every kiln command, generated from the CLI's help text.
owner: docs
section: Developer tools
generated: true
---

The `kiln` CLI validates and applies factory definitions locally and talks to a Kiln server for everything else.

Set `KILN_URL` (default `http://localhost:4000`) and `KILN_TOKEN`, or put `{ "url": "...", "token": "..." }` in `~/.kiln/config.json`. In this repository run it as `pnpm kiln <command>`; paths resolve from the directory you ran pnpm in.

```text
kiln — self-hostable software factories

Definitions (local)
  kiln init [dir] [--template sdlc|single-repo|po-feature|incident]   Scaffold a definition tree
  kiln validate [path]                                                Schema and reference checks; exit 1 on errors
  kiln diff [path] [--against applied|<path>] [--factory <id>]        What an apply would change
  kiln import <src> [out]                                             Convert a v1alpha1 tree to kiln/v1
  kiln schema <kind>                                                  JSON Schema for a file kind

Factory (needs KILN_URL and KILN_TOKEN)
  kiln apply [path] [--dry-run] [--canary 10%] [--factory <id>]       Apply atomically, or as a canary
  kiln connect <owner/repo> [--dir <path>] [--ref main]               Store a factory in a GitHub config repo
  kiln factories                                                      List factories
  kiln send "<task>" --factory <id> [--body <text>]                   Create a work item
  kiln pull <task>                                                    Take a task to a local worktree
  kiln handback <task> [message]                                      Return it to the factory
  kiln runs [--factory <id>] [--work-item <id>]                       List runs
  kiln inbox [--all]                                                  Decisions waiting on you
  kiln decide <gate> approve|reject|answer [text]                     Decide a gate
  kiln replay <run> [--with <sha>]                                    Replay a run, optionally under another definition
  kiln steer <run> <message>                                          Steer a running agent
  kiln bench run <suite> --factory <id>                               Run a benchmark suite
  kiln metrics --factory <id> [--since <iso>]                         Factory metrics
  kiln token create --name <n> --subject <email> --grants read:*,send:webapp
```

## Exit codes

- `0` success.
- `1` validation errors (printed as `file:line: message`), API errors (`error <status>: <message>`) or bad arguments.

## Related pages

- [API reference](api.md)
- [Kiln MCP](mcp.md)
- [Definitions as code](../configuration/definitions-as-code.md)
