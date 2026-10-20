---
name: repository-conventions
description: How this repository names things, tests code and opens pull requests
owner: platform
version: "1"
---
- Named exports; no default exports except framework entry points.
- Validate input at every boundary with zod.
- One behavior per test; test names say what should happen.
