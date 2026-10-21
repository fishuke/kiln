# Model fallback chain for agent runs

## What we are solving

A run dies because of **where the model is**, not because of **what the task is**. Today a rate limit or an
exhausted usage window ends the work item, even though another model on the same subscription could finish it.

What happens now, in `packages/engine/src/runs.ts` and `errors.ts`:

1. The harness fails with "rate limit", "429" or "overloaded". `classifyError` maps it to `resource_unavailable`,
   which is retried automatically.
2. `RunService.execute` retries up to `maxRunAttempts` (default 3) times, **on the same model, with no wait**.
   A limit that lasts minutes or hours is still there on attempt 2 and 3, so all three attempts burn in seconds.
3. A Claude "usage limit reached" message matches no pattern, so it becomes `internal_error`, which is also
   retried three times on the same model, then the run ends in `error`.
4. The task stops. A person has to notice, wait for the window to reset, and press retry.

Why the same-model retry cannot fix it: Claude subscriptions have a shared 5-hour and 7-day window plus a
**per-model weekly window** (the credential pool already records it as `seven_day_fable`, see
`platform/credential-pool.ts`). When the Fable window is spent, Opus and Sonnet on the same token still work.
The credential pool rotates **tokens**, not models, so with one token it has nothing to rotate to.

What we want instead: when the primary model is unavailable, the step runs on the next model in a short list,
the run record says which model actually did the work, and the person reading the result knows it.

What we do **not** want: masking real failures. A bad prompt, a missing secret, a budget cap or a content
refusal would fail the same way on any model, and retrying them on a cheaper model would hide the cause and
spend money. Only "the model is not available right now" falls back.

## Why the default chain is fable → opus → sonnet

- It is the order of capability **and** of how often the limits bite. Fable has the smallest weekly window
  and is the one that runs out; Opus and Sonnet almost never do. Falling "down" the chain keeps the most
  capable model that is still available.
- "After the primary" means the chain is a ranking, not a list to walk from the top. An agent on Opus must
  not fall back *up* to Fable (that would be a surprise cost increase and probably hits the same spent window);
  it goes to Sonnet. An agent on Sonnet has nowhere to go and fails as today.
- A default at all, rather than opt-in: the factories we run (including `factories/kiln-self`) mostly put
  Fable on spec and review agents, and those are the runs that hit the window. Without a default, every factory
  has to discover the problem the same way and add the same three lines. The default is only for `claude-code`
  agents; other harnesses have no default because we cannot pick a sensible chain for them.
- Why the empty list disables it: the field is inherited like every other `harness` key, so an agent needs a
  way to say "no fallback for me" that survives `agentDefaults` setting a chain. `null` means "clear my override
  and inherit", so it cannot also mean "off". `[]` is the natural "nothing to fall back to". Use it for an agent
  whose output must come from one specific model (a benchmark, or a review the owner only trusts from Fable).

## Behavior

- An agent may list `harness.fallbackModels`: model ids tried in order after the primary model fails for a
  fallback-eligible reason. Only models that come **after** the primary in the list are tried.
- `claude-code` agents with no `fallbackModels` get the default chain `claude-fable-5-1`, `claude-opus-5-5`,
  `claude-sonnet-5-5`, again restricted to models after the primary. Other harnesses (codex, opencode, gemini,
  pi) have no default chain and fall back only when configured. `fallbackModels: []` turns fallback off.
- Eligible failures are exactly: model unavailable or overloaded, rate limit (429), and subscription usage limit
  (Claude usage limit, Codex `usage_limit_reached`). Auth, budget, credits, content policy, setup, timeout,
  process and guardrail failures never fall back.
- A fallback is a new attempt of the same run record on the next model, with the same prompt, instructions and
  workspace setup. It does not count against `maxRunAttempts`, and the failure that triggered it is not also
  retried on the same model. Each step (spec, implement, review, …) starts from its own primary model; a
  fallback in one step does not carry into the next.
- Per step, each model in the chain is tried at most once. When the chain is exhausted the run fails with the
  last error, as today.
- The run records the model it actually used and the models it skipped, and says so in its activity log.
  A run on a fallback model shows both the configured and the used model.
- If the run belongs to a Linear agent session, a thought says "<model> was unavailable (<reason>); continuing
  on <next model>", and the "Started …" thought names the model in use.

## Constraints

- Definitions stay in Git, run state in the Store; the used model is run state. Fallback grants no new
  permission (ADR-0008 and the CLAUDE.md rule on identities are unaffected).
- `harness.model` and `fallbackModels` resolve under the existing `harness` / `model` inheritance rules in
  `packages/definitions/src/resolve.ts`. `model: router:<name>` picks the primary only; fallbacks are literal ids.
- Eligibility is decided by one classifier in the engine with a typed result, not by string matching in
  callers. Harness adapters surface the provider's message unchanged.
- Time comes from the injected Clock; no new external system, so no new interface.
- Protected paths (`packages/definitions/src/validate*`, `gates.ts`, `state.ts`, `app.ts`) are not edited
  without asking. Chain validation belongs in the zod schema in `packages/schema`.
- Keep the PR under ~400 changed lines.

## User stories

- As a factory owner, I want a run that hit a Fable limit to continue on Opus so a work item is not stuck
  until the window resets and nobody has to press retry.
- As an agent author, I want to set my own fallback list, or none, per agent, so cost and quality stay under
  my control.
- As a reviewer, I want to see which model wrote a spec or change, so I judge it knowing it ran on a fallback.
- As a Linear user watching the agent session, I want to be told when the model changed.
- As an operator, I want a wrong API key or a budget cap to fail loudly as today, not to be retried on three
  models before I hear about it.

## Acceptance criteria

- AC1: `harness.fallbackModels` (array of non-empty strings, no duplicates, may be empty) is accepted in agent
  files, `agentDefaults` and automation overrides, inherits like other harness keys, and `null` clears it; an
  invalid value (non-array, empty string, duplicate) is rejected with a message naming the field.
- AC2: A claude-code agent with no `fallbackModels` and primary `claude-fable-5-1` falls back to
  `claude-opus-5-5`, then `claude-sonnet-5-5`; with primary `claude-opus-5-5` only to `claude-sonnet-5-5`;
  with primary `claude-sonnet-5-5`, or with `fallbackModels: []`, it never falls back. A codex agent with no
  `fallbackModels` never falls back.
- AC3: A failure matching rate limit (429), overloaded / model unavailable, or usage limit (Claude and Codex
  wordings) triggers a retry on the next model in the chain.
- AC4: Failures classified as authentication, budget, insufficient credits, content policy, environment setup,
  timeout, agent process failure or guardrail denial do not fall back, and the run fails with that error.
- AC5: Each model is tried at most once per step, in chain order; after the last model fails the run ends with
  the last error and no further attempt.
- AC6: A fallback attempt keeps the same run id, prompt and instructions, does not consume `maxRunAttempts`,
  and the next step starts from its own primary model.
- AC7: The run record stores the model used (`model`), the configured model, and the models skipped with their
  failure codes; the run's activity log has a `fallback` event for each switch; the run page and `kiln run get`
  show the used model and, when it differs, the configured one.
- AC8: For a run with a Linear session, a thought announces each switch and names the new model; a run with no
  fallback posts nothing extra.
- AC9: `fallbackModels: []` on an agent whose `agentDefaults` set a chain disables fallback for that agent only.
- AC10: Tests use fakes only (FakeHarness failing with each eligible and ineligible message, fake Clock); docs
  are updated: `docs/site/configuration/agents.md` (field, default chain, what triggers it, how to turn it off)
  and the error reference in `docs/site/developer-tools/tasks-and-runs.md`, with `pnpm docs:gen` run and the
  JSON schema output regenerated.

## Open questions

- Should the default chain exist at all, or should fallback be opt-in per factory? The issue asks for the
  default; the rationale above is the case for it. If the owner prefers opt-in, AC2 becomes "no chain unless
  configured" and the rest of the spec stands.
- "Retry once per step" in the issue: one fallback attempt per step, or each model in the chain once per step?
  This spec assumes the latter, since one switch per step makes the second fallback (`sonnet`) unreachable
  by default.
- Should a usage limit that resets soon (Codex gives a reset time, see `codexUsageLimitReset`) wait instead of
  switching to a weaker model?
- When the credential pool has another token for the same model, is token rotation tried before model
  fallback? This spec assumes yes: rotate first where it exists today, fall back on model only when the pool
  has nothing left.
- Do `router:` primaries get the default Claude chain, or only explicit lists? Assumed: only explicit lists.
- Should a person be told (inbox, not just the activity log) when a spec or implement step ran on a fallback?
- Do the default model ids live in code or in a factory-level setting, since model names change?
