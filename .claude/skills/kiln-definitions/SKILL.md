---
name: kiln-definitions
description: Rules and fixtures for Kiln factory definition files (kiln/v1, Warp v1alpha1 import). Use when editing packages/schema, packages/definitions or any factory.yaml tree.
---
- Schemas live in packages/schema/src/index.ts; every object is `.strict()` (unknown keys are errors).
- Add a valid and an invalid fixture in packages/schema/fixtures for every new key.
- Cross-reference checks live in packages/definitions/src/validate.ts and report `file:line: message`; add a case to definitions.test.ts with the exact message.
- Warp trees convert in packages/definitions/src/warp.ts; the 8 public examples and fixtures/warp/08-kiln-config must keep validating.
- Run `pnpm kiln validate <dir>` on factories/templates/* and factories/kiln-self after changes.
