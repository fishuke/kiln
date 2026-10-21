# Model fallback chain for agent runs

## Problem

When the model an agent runs on is unavailable, rate-limited or out of usage, the run fails. Today
`classifyError` maps "rate limit / 429 / overloaded" to `resource_unavailable`, which `RunService.execute`
retries up to `maxRunAttempts` times on the **same** model, so a limit that lasts minutes or hours burns every
attempt. Usage-limit messages ("usage limit reached", `usage_limit_reached`) are not classified as retryable at all.
The work item then stops although a cheaper model could have finished the job.

## Behavior

- An agent may list `harness.fallbackModels`: model ids tried in order after the primary model fails for a
  fallback-eligible reason.
- Claude Code agents with no `fallbackModels` get the default chain, restricted to models after the primary:
  `claude-fable-5-1` → `claude-opus-5-5` → `claude-sonnet-5-5`. An agent on `claude-sonnet-5-5` has no fallback.
  Other harnesses (codex, opencode, gemini, pi) have no default chain; they fall back only when configured.
  `fallbackModels: []` turns fallback off.
- Eligible failures are exactly: model unavailable or overloaded, rate limit (429), and subscription usage limit
  (Claude AI usage limit, Codex `usage_limit_reached`). Auth, budget, content policy, setup, timeout, process and
  tool failures never fall back.
- A fallback is a new attempt of the same run record on the next model, with the same prompt and workspace
  setup. It does not count against `maxRunAttempts` and does not apply the automatic same-model retry to the
  failure that triggered it. Each step (spec, implement, review, …) starts again from its own primary model; a
  fallback in one step does not carry into the next.
- Per step, each model in the chain is tried at most once. When the chain is exhausted the run fails with the
  last error, as today.
- The run records the model it actually used and the models it skipped, and says so in its activity log.
  A run on a fallback model shows both the configured and the used model.
- If the run belongs to a Linear agent session, a thought says "<model> was unavailable (<reason>); continuing on
  <next model>", and the "Started …" thought names the model in use.

## Constraints

- Definitions stay in Git, run state in the Store; the used model is run state (ADR-0008 and the CLAUDE.md
  rule on identities are unaffected: fallback grants no new permission).
- `harness.model` and `fallbackModels` must resolve under the existing `harness` / `model` inheritance rules in
  `packages/definitions/src/resolve.ts`. `model: router:<name>` picks the primary only; fallbacks are literal ids.
- Eligibility is decided by one classifier in the engine, with a typed result, not by string matching in
  callers. Harness adapters surface the provider's message unchanged.
- Time (retry backoff, if any) comes from the injected Clock; no new external system, so no new interface.
- Protected paths (`packages/definitions/src/validate*`, `gates.ts`, `state.ts`, `app.ts`) are not edited
  without asking. Chain validation belongs in the zod schema in `packages/schema`.
- Keep the PR under ~400 changed lines.

## User stories

- As a factory owner, I want a run that hit a Fable limit to continue on Opus so a work item is not stuck
  until the limit resets.
- As an agent author, I want to set my own fallback list (or none) per agent, so cost and quality stay under
  my control.
- As a reviewer, I want to see which model wrote a spec or change, so I can judge it knowing it ran on a
  fallback.
- As a Linear user watching the agent session, I want to be told when the model changed.

## Acceptance criteria

- AC1: `harness.fallbackModels` (array of non-empty strings, no duplicates, may be empty) is accepted in agent
  files, `agentDefaults` and automation overrides, inherits like other harness keys, and `null` clears it; an
  invalid value is rejected with a message naming the field.
- AC2: A claude-code agent with no `fallbackModels` and primary `claude-fable-5-1` falls back to
  `claude-opus-5-5`, then `claude-sonnet-5-5`; with primary `claude-opus-5-5` only to `claude-sonnet-5-5`;
  with primary `claude-sonnet-5-5` or `fallbackModels: []` it never falls back.
- AC3: A failure matching rate limit (429), overloaded / model unavailable, or usage limit (Claude and Codex
  wordings) triggers a retry on the next model in the chain.
- AC4: Failures classified as authentication, budget, insufficient credits, content policy, environment setup,
  timeout, agent process failure or guardrail denial do not fall back, and the run fails with that error.
- AC5: Each model is tried at most once per step, in chain order; after the last model fails the run ends with
  the last error and no further attempt.
- AC6: A fallback attempt keeps the same run id, prompt and instructions, does not consume `maxRunAttempts`,
  and the next step starts from its own primary model.
- AC7: The run record stores the model used (`model`) and the configured model plus the models skipped with
  their failure codes; the run's activity log has a `fallback` event for each switch, and the run page and
  `kiln run get` show the used model.
- AC8: For a run with a Linear session, a thought announces each switch and names the new model; a run with no
  fallback posts nothing extra.
- AC9: `fallbackModels: []` on an agent whose defaults set a chain disables fallback for that agent.
- AC10: Tests use fakes only (FakeHarness failing with each eligible and ineligible message, fake Clock); docs
  are updated: `docs/site/configuration/agents.md` (field, default chain, what triggers it) and the run/error
  reference, with `pnpm docs:gen` run for the schema, and the JSON schema output regenerated.

## Open questions

- "Retry once per step": does this mean one fallback attempt per step, or each model in the chain once per
  step? This spec assumes the latter (needed for a three-model chain to be reachable); one switch per step
  would make the second fallback (`sonnet`) unreachable by default.
- Should a usage limit that resets soon (Codex gives a reset time; see `codexUsageLimitReset`) wait instead of
  switching to a weaker model?
- Should fallback also apply when the credential pool has another credential for the same model
  (`credential-pool.ts`)? This spec assumes credential rotation is tried first where it exists today, and the
  model fallback only when the pool has nothing left.
- Do `router:` primaries get the default Claude chain, or only explicit lists? Assumed: only explicit lists.
- Should a human be told (inbox, not just the activity log) when a spec or implement step ran on a fallback?
- Are the default model ids to be kept in code or in a factory-level setting, since model names change?
