---
description: Take the next kiln-ready issue and run it through spec, tests, implementation and review
---
Find the oldest open GitHub issue in this repo labeled `kiln-ready` that has no linked PR (`gh issue list --label kiln-ready`), print its number, title and acceptance criteria, create the branch `issue/<number>-<slug>`, then run the architect (if it touches more than one package), test-writer, implementer and reviewer subagents in that order. Stop and ask if the criteria are unclear.
