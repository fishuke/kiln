---
name: adapter-contracts
description: How to add a harness, sandbox, forge, tracker, chat or preview adapter with a fake and contract tests.
---
- Harness: implement HarnessAdapter in packages/harness and add it to the contract suite in contract.test.ts with an emulator of the CLI's JSON stream.
- Sandbox: implement SandboxProvider; guard every agent command; support snapshot/resume; test with FakeCommandRunner.
- Forge/tracker/chat/preview: implement the interface in packages/integrations, keep a fake, test request shapes with a fake fetch.
- Wire it in apps/api/src/config.ts behind an environment variable; local mode must keep working with no credentials.
