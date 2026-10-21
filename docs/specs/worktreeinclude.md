# Copy gitignored files into run checkouts with .worktreeinclude

## Problem
A run clones the repository fresh, so files git ignores (`.env`, local config, certificates) are missing and the agent
cannot run the app or its tests. Today the only way to provide them is a worker volume mount, which cannot be limited
to the files a repository wants. Cyrus solves this with a `.worktreeinclude` file; Kiln should accept the same file.

## Why this is needed
Asked in review by fishukee@gmail.com: "why is this necessary tho?" Short answer: it is not necessary for every
team, but every way Kiln has today to get a local-only file into a checkout has a gap, and the gaps add up for the
common case of an app that reads `.env` at startup.

What exists today and where it stops:
- **Team secrets** (`secrets:` on an agent) arrive as environment variables, never as files. An app or test suite
  that reads `.env`, a `local.json` or a certificate from disk does not see them. Kiln also only puts secrets of a
  known type into provider variables; it has no "write this secret to this path" option.
- **Runner `setupCommands`** are definitions and live in Git, so they cannot contain the secret contents. A setup
  command can `echo "$VAR" > .env` from an environment variable, but then every file needs a secret per line and a
  command per file, and the pattern has to be repeated in every factory.
- **Worker `--volumes`** mounts a host directory into every Docker sandbox on that worker, for every repository and
  every run, with no per-repository scoping. It is a worker-wide setting that the repository cannot shape, and the
  `local` backend has no mounts at all.
- **Run input `files`** are set by Kiln itself (prompts, specs) at run creation; people do not control them, and they
  are not meant to carry secrets.

What `.worktreeinclude` adds: the repository, not the operator, says which ignored files it needs; the operator keeps
the real files on the worker, never in Git or in the factory; and the copy is scoped per repository and refused
outside the source directory. Cyrus users already keep such a file, so repositories moving to Kiln bring it unchanged.

When it is not needed: if all your apps and tests read configuration from environment variables only, team secrets
already cover you and this feature can be ignored. With no `.worktreeinclude` and no source configured, nothing
changes (AC4).

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
- Every candidate path is resolved with `realpath` against `<source>/<repo>/` before it is read. A path is refused
  when the resolved source path is not inside `<source>/<repo>/` (because of `..`, an absolute pattern, or a symlink
  whose target lies outside) or the destination path is not inside the checkout. A refused path is skipped and the
  run records one event `{ type: "worktreeinclude", data: { repo, refused: <pattern or relative path>, reason } }`
  where `reason` is one of `outside-source`, `absolute-pattern`, `symlink-outside-source`, `outside-checkout`.
  Refusal never changes the run's status.
- Symlinks whose target stays inside `<source>/<repo>/` are followed; the checkout gets a regular file.
- After copying, the run records one event `{ type: "worktreeinclude", data: { repo, copied: [relative paths] } }`.
  File contents never appear in events, transcripts or worker logs.

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
- AC5a (parent traversal): Source `<source>/<repo>/` holds `ok.txt`; `<source>/secret` holds a file outside the repo
  subdirectory; `.worktreeinclude` lists `../secret` and `ok.txt`; both paths are git-ignored. After the run starts,
  the checkout contains `ok.txt`, no file named `secret` exists anywhere in the checkout, and the run's events include
  one with `type: "worktreeinclude"`, `data.refused: "../secret"` and `data.reason: "outside-source"`. The run reaches
  the agent (an event of type `started` follows).
- AC5b (absolute pattern): `.worktreeinclude` lists `/etc/hostname` (a file that exists on the host). The checkout does
  not contain `etc/hostname` or `hostname`, and an event with `type: "worktreeinclude"`,
  `data.refused: "/etc/hostname"` and `data.reason: "absolute-pattern"` is recorded. The run reaches the agent.
- AC5c (symlink out of the source): `<source>/<repo>/link.txt` is a symlink to a file outside `<source>/<repo>/`;
  `.worktreeinclude` lists `link.txt` and it is git-ignored. The checkout contains no `link.txt` (neither the link nor
  the target's contents), and an event with `type: "worktreeinclude"`, `data.refused: "link.txt"` and
  `data.reason: "symlink-outside-source"` is recorded. The run reaches the agent.
- AC5d (symlink inside the source): `<source>/<repo>/link.txt` is a symlink to `<source>/<repo>/real.txt`;
  `.worktreeinclude` lists `link.txt`. The checkout contains a regular file `link.txt` with the contents of `real.txt`
  (the link is followed, not copied as a link).
- AC5e (no fail on refusal): In AC5a–AC5c the run's final status is the same as it would be with an empty
  `.worktreeinclude`; a refused path never sets the run to `failed` or `error`.
- AC6: Nested files (`config/local.json`) are copied with their directories created and their file mode preserved.
- AC7: In a run with several repositories, each repository gets only files from its own `<source>/<repo>/` using its
  own `.worktreeinclude`.
- AC8: The same behavior holds in `kiln worker` and in the in-process runner. The worker config accepts
  `worktreeIncludeSource` and rejects a non-string value.
- AC9: After copying, exactly one event with `type: "worktreeinclude"` and `data.copied: [<repo-relative paths>]` is
  recorded per repository that copied at least one file. Given a copied `.env` containing the string
  `SECRET=hunter2-marker`, that string appears in no run event's `text` or `data`, in no transcript object, and in no
  worker log line.
- AC10: Docs describe the file, the source directory layout, the config option and the safety rules.

## Open questions
- Is the feature worth building at all (fishukee@gmail.com)? Answered above under "Why this is needed": optional,
  but the alternatives each leave a gap. Reviewers decide whether the gap matters for their repositories.
- Source layout: is `<source>/<repo name>/` right, or should the source be the main clone of a single repository
  (Cyrus's behavior)? The spec assumes the per-repository subdirectory so multi-repo runs work.
- Should the source be settable per runner definition in the factory (definitions in Git), or only on the worker/
  server as stated in the issue? The spec follows the issue: worker/server only.
- Kubernetes sandbox: out of scope here (no host path to copy from). Confirm that is acceptable.
- Size cap per file and in total? Suggest 1 MiB per file and 100 files; not set in this spec.
- Should a refused path fail the run instead of being skipped? The spec skips and records an event.
