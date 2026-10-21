# Copy gitignored files into run checkouts with .worktreeinclude

## Problem
A run clones the repository fresh, so files git ignores (`.env`, local config, certificates) are missing and the agent
cannot run the app or its tests. Today the only way to provide them is a worker volume mount, which cannot be limited
to the files a repository wants. Cyrus solves this with a `.worktreeinclude` file; Kiln should accept the same file.

## Behavior
- A repository may contain `.worktreeinclude` at its root, in gitignore syntax. It lists files to copy into every run's
  checkout.
- The runner/worker is configured with one **source directory** on the machine that creates the sandbox. For the repo
  named `<repo>`, files come from `<source>/<repo>/`, so one source directory serves several repositories.
- A file is copied only if **all** hold: it exists under the source directory, it matches `.worktreeinclude`, and the
  checkout's own `.gitignore` rules ignore it. Tracked files are never overwritten, and `.worktreeinclude` cannot be
  used to copy files that git would not ignore.
- Copying happens once per repository, after the clone and branch checkout and before setup commands and the agent
  start. It applies to the in-process runner (`packages/engine/src/runs.ts`) and to `kiln worker`
  (`packages/engine/src/worker-runtime.ts`), on the local and Docker sandboxes (via `Sandbox.writeBytes`).
- Configuration: `kiln worker --worktree-include-source DIR` (and the worker config file key
  `worktreeIncludeSource`); for the server, `KILN_WORKTREEINCLUDE_SOURCE`.
- Source paths that resolve outside `<source>/<repo>` (`..`, absolute patterns, or a symlink pointing out) and
  destination paths that resolve outside the repository are refused: the file is skipped, never copied, and the run
  records an activity event naming the path. A refused path does not fail the run.
- Copied file names (not contents) are recorded in the run's activity log. Contents are never logged.

## User stories
- As a developer, I list `.env` in `.worktreeinclude` so the agent's checkout can start the app without me committing
  secrets.
- As a worker operator, I point the worker at a directory of per-repository local files and know that only files each
  repository asks for are copied.
- As a security reviewer, I need `.worktreeinclude` in a repository (which an agent could edit) to be unable to read
  files outside the configured source directory.

## Constraints
- Respect the architecture rules: the logic lives in `packages/sandbox` behind the `Sandbox` interface and works with
  the fake sandbox in tests; no edits to protected paths.
- zod validates the worker config. Errors are typed results, not thrown strings.
- Never contradicts an accepted ADR (to check against `docs/adr/` before implementation).
- Docs: `docs/site/infrastructure/self-hosted-workers.md`, `sandboxes.md`, and a short `.worktreeinclude` section;
  run `pnpm docs:gen` if the CLI reference changes.

## Acceptance criteria
- AC1: With a source configured, a file that matches `.worktreeinclude`, exists in the source and is git-ignored in the
  checkout is present in the checkout, with the same contents, before the agent starts.
- AC2: A file that matches `.worktreeinclude` but is not ignored by the checkout's `.gitignore` is not copied, and a
  tracked file is never overwritten.
- AC3: A file in the source that `.worktreeinclude` does not match is not copied. Gitignore syntax works: globs,
  directories, `!` negation and comments.
- AC4: With no `.worktreeinclude` in the repository, or no source configured, nothing is copied and the run starts
  normally with no error.
- AC5: A pattern or symlink that resolves outside `<source>/<repo>` (for example `../secret`, `/etc/passwd`, or a link
  to a file elsewhere) is refused: nothing outside is copied, the run still starts, and the activity log names the
  refused path.
- AC6: Nested files (`config/local.json`) are copied with their directories created and their file mode preserved.
- AC7: In a run with several repositories, each repository gets only files from its own `<source>/<repo>/` using its
  own `.worktreeinclude`.
- AC8: The same behavior holds in `kiln worker` and in the in-process runner. The worker config accepts
  `worktreeIncludeSource` and rejects a non-string value.
- AC9: Copied file names appear in the run's activity log; file contents do not appear in any log, event or artifact.
- AC10: Docs describe the file, the source directory layout, the config option and the safety rules.

## Open questions
- Source layout: is `<source>/<repo name>/` right, or should the source be the main clone of a single repository
  (Cyrus's behavior)? The spec assumes the per-repository subdirectory so multi-repo runs work.
- Should the source be settable per runner definition in the factory (definitions in Git), or only on the worker/
  server as stated in the issue? The spec follows the issue: worker/server only.
- Kubernetes sandbox: out of scope here (no host path to copy from). Confirm that is acceptable.
- Size cap per file and in total? Suggest 1 MiB per file and 100 files; not set in this spec.
- Should a refused path fail the run instead of being skipped? The spec skips and records an event.
