# Guardrail against unshipped work at the end of build runs

## Problem
A build run can end "succeeded" while its work only exists in the sandbox checkout: files the agent never
committed, or commits that never reached the remote branch. The work item then moves on (PR, verify) with
nothing, or only part, of the change. Today `pushBranches` (`packages/engine/src/runs.ts`) commits leftovers and
pushes after a successful run, but nothing checks the result, the agent never hears about it, and remote workers
and failed pushes can still leave work behind unnoticed.

## Behavior
- "Build run" means a run of kind `work` that is due to push (`push` true and a branch set), including each
  per-user-story run of the build stage. Plan-only, spec, verify, review and route runs are out of scope.
- When such a run finishes with status `succeeded`, Kiln inspects each repository checkout in the sandbox:
  - **Uncommitted**: `git status --porcelain` is not empty (new, modified or deleted files).
  - **Unpushed**: HEAD differs from `refs/heads/<branch>` on the remote, and HEAD differs from the run's start sha.
- If either is found, Kiln sends the agent exactly one follow-up in the same run, naming the repositories and
  listing up to 20 affected paths or commits, and asking it to commit (and push if it can) the work.
- After the follow-up the checkout is inspected again. If work is still unshipped, the run ends `failed` with
  `error.message` "Unshipped work after follow-up: <repo>: <n> uncommitted files, <m> unpushed commits"
  (not retryable), and the activity log records the check, the follow-up and the failure.
- Runs that are clean at the first check get no follow-up, no extra cost and no extra events.
- Remote workers apply the same check; the engine does not rely on the worker to do it.

## Constraints
- Agents hold no merge or approve permission and push only to their own branch with the scoped token; the
  follow-up never asks for anything else, and never touches `main`.
- At most one follow-up per run; the follow-up's cost counts toward the run and work item budget.
- Time comes from the injected Clock; git access goes through the sandbox interface and works with the Fake.
- No change to protected paths (`gates.ts`, `state.ts`, `app.ts`, `packages/auth/**`).
- Keep the change under ~400 lines.

## Acceptance criteria
- AC1: A succeeded build run with uncommitted changes in its checkout gets exactly one follow-up asking it to commit.
- AC2: A succeeded build run with commits not on the remote branch gets exactly one follow-up asking it to ship them.
- AC3: If the work is still unshipped after the follow-up, the run is `failed` with a message naming the repository and counts.
- AC4: If the follow-up ships the work, the run stays `succeeded` and its `result.pushed` lists the push.
- AC5: A build run with nothing to ship gets no follow-up and its events and cost are unchanged.
- AC6: Non-build runs (plan-only, spec, verify, review, route) and runs that did not succeed are never checked.
- AC7: The check covers every repository of a multi-repo run and runs on remote workers.
- AC8: The follow-up and the failure show in the run's activity log.
- AC9: Tests cover AC1–AC8 against the Fake sandbox; `docs/site/infrastructure/harnesses.md` and
  `docs/site/configuration/pipelines-and-gates.md` describe the guardrail; `pnpm docs:gen` is run if needed.

## User stories
- As a product owner, I never see a build marked done whose changes are missing from the branch.
- As an engineer reading a failed run, I see which repository has unshipped work and how much.
- As an agent, I get one clear chance to fix an oversight before the run fails.

## Open questions
- The issue says "commit and push", but the agent prompt (`runs.ts:87`) says agents must not push; Kiln pushes with
  a scoped token. Should the follow-up ask only for a commit, with Kiln retrying its own push afterwards?
- `pushBranches` already auto-commits leftovers. Should that stay (so the follow-up mainly covers failed pushes and
  worker runs), or be replaced by the follow-up so the agent writes the commit message?
- Should files ignored by `.gitignore` or under `.kiln/` count as unshipped? Assumed no.
- What should happen on a follow-up that errors or exceeds the budget: fail with that reason, or with the unshipped one?
- Should the failure be retryable once through the existing build retry loop (`build-errors`)? Assumed yes, as for any failed run.
