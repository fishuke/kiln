# Guided setup skill (`/kiln-setup`)

Work item: `mvh52wii01e4hbd` (feature, size m).

## Problem

Setting Kiln up by hand means reading [Self-hosting](../site/infrastructure/self-hosting.md), [Linear](../site/integrations/linear.md) and
[GitHub](../site/integrations/github.md) and doing a dozen steps in the right order: prerequisites, Claude auth, public URLs,
a Linear OAuth app with the right redirect URL and webhook events, GitHub access, a first factory and a first issue. People miss
a step (most often the Linear webhook events or `KILN_PUBLIC_URL`) and only find out when nothing happens after the first issue.

Atlas ships `cyrus-setup-*` skills that walk a person through this with an agent. Kiln should ship the same: a `/kiln-setup`
skill that a person runs in Claude Code from a clone of this repository, which orchestrates one sub-skill per step and checks
each step's result before moving on.

## User stories

- **S1.** As a person with a Coolify (or any Docker host) deployment, I run `/kiln-setup` in Claude Code and end with Kiln reachable
  on its public URL, Claude auth working, Linear and GitHub connected, a factory for my repositories, and a first test issue that
  started a run.
- **S2.** As a developer trying Kiln on my laptop with `pnpm dev`, the same skill takes me through the local variant, including
  how to expose a public URL for webhooks, and skips what a local install does not need.
- **S3.** As an admin, I can trust that the agent running the skill never sees, prints, logs or commits a secret value. I paste
  tokens myself, and the skill only checks that they are present.
- **S4.** As a person whose step failed, the skill tells me which check failed, what to fix, and does not continue to the next step
  until the check passes.
- **S5.** As someone reading the docs, I find the guided setup from the Self-hosting page.

## Behavior

### Layout

```
skills/
  kiln-setup/SKILL.md                 # orchestrator
  kiln-setup-prerequisites/SKILL.md
  kiln-setup-claude-auth/SKILL.md
  kiln-setup-public-url/SKILL.md
  kiln-setup-linear/SKILL.md
  kiln-setup-github/SKILL.md
  kiln-setup-factory/SKILL.md
  kiln-setup-first-issue/SKILL.md
```

Each file has the same frontmatter as a factory skill (`name`, `description`; see [Skills](../site/configuration/skills.md)) so Kiln's
parser accepts it, and `name` equals the directory name. Claude Code discovers skills under `.claude/skills/`, so each
`skills/kiln-setup*` directory is also reachable as `.claude/skills/kiln-setup*` (see open question Q1).

### The orchestrator

`skills/kiln-setup/SKILL.md`:

1. Asks which deployment this is: **local** (`pnpm dev`, or `docker-compose.yml` on one machine) or **server** (Coolify or any
   Docker host with `docker-compose.prod.yml`). Every sub-skill reads this answer.
2. Runs the sub-skills in the order above. After each one, it runs that sub-skill's **Check** and continues only when the check
   passes. When a check fails, it follows the sub-skill's **If the check fails** section, then runs the check again. It never
   skips a failed step silently; it may skip Linear or GitHub only when the person says they do not use that system.
3. Ends with a summary of what is configured, what was skipped, and the link to watch the first run.

### The sub-skills

Each sub-skill is short, links to the docs page for the details instead of restating them, and has three sections: **Do**,
**Check** (a command or API call and the expected result) and **If the check fails**. Where local and server differ, the
sub-skill has a **Local** and a **Server (Coolify or Docker)** variant.

| Sub-skill     | Do                                                                                                                                                                                                                                                                                                                      | Check                                                                                                                                                                                                                                                         |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| prerequisites | Local: Node 22, pnpm 10, git, Docker (optional), the `claude` CLI. Server: Docker with Compose, a server of its own (the Docker socket is root), two DNS names (web and API), `KILN_OWNER_EMAIL`, `KILN_SECRET_KEY` from `openssl rand -hex 32`.                                                                        | `node -v`, `pnpm -v`, `docker info`, `claude --version` succeed; the server variables are set (presence only).                                                                                                                                                |
| claude-auth   | The person runs `claude setup-token` in their own terminal (or picks `ANTHROPIC_API_KEY`) and puts the value where the deployment reads it: `.env` (local), Coolify's environment or a Kiln secret (server). `KILN_AGENTS=real` for Docker Compose.                                                                     | The variable is present and non-empty, checked without printing it (for example `grep -q '^CLAUDE_CODE_OAUTH_TOKEN=.' .env`, or the secret's name is listed by `GET /api/v1/secrets`). Then `pnpm smoke:claude` (local) or one real run later in first-issue. |
| public-url    | `KILN_PUBLIC_URL` (API) and `KILN_WEB_URL` (web). Server: the two domains. Local: a tunnel (for example `cloudflared tunnel --url http://localhost:4000`) for webhooks, and `http://localhost:3000` for the web URL. Explains that without the public URL the command guard and the Kiln MCP are not installed in runs. | `GET <KILN_PUBLIC_URL>/api/v1/health` returns `ok` from outside the machine; `pnpm health` passes.                                                                                                                                                            |
| linear        | OAuth app with redirect URL `<KILN_PUBLIC_URL>/oauth/linear/callback`; webhook `<KILN_PUBLIC_URL>/webhooks/linear` for **Issues**, **Comments** and **Agent session events**; `LINEAR_CLIENT_ID`, `LINEAR_CLIENT_SECRET`, `LINEAR_WEBHOOK_SECRET`; connect the workspace in the web app.                                | `GET /api/v1/connections` shows `linear` as `connected`, and `list_tracker_scopes` (or the Linear directory) lists at least one team.                                                                                                                         |
| github        | One click: **Integrations → GitHub → Create GitHub App**, install on the repositories. By hand: the app, its permissions and webhook events from the GitHub page. Never give the app a branch-protection bypass; protect `main`.                                                                                        | `GET /api/v1/forge/repositories` lists the repositories the person named.                                                                                                                                                                                     |
| factory       | Takes a list of `owner/name` repositories (and the Linear teams, when Linear is connected). Creates the factory with `create_factory` using `dry_run: true` first to show the files, then for real; or the web wizard at `<KILN_WEB_URL>/create`.                                                                       | `list_factories` (or `kiln factories`) shows it with the repositories, and the `factory:<alias>` label exists on each repository.                                                                                                                             |
| first-issue   | Creates a test issue: on GitHub, an issue that mentions `@kiln-factory` with the `factory:<alias>` label; on Linear, an issue delegated to the factory's app. Tells the person where to watch it.                                                                                                                       | `list_tasks` shows a task for the issue within a few minutes, and `get_task` shows a run that started. The summary links `<KILN_WEB_URL>/runs/<task>`.                                                                                                        |

### Secrets

- The skills tell the agent to never print, echo, log, paste into a chat reply, or commit a secret value, and to never run a
  command whose output would contain one (for example `cat .env`, `env`, `docker compose config`).
- Checks test presence only: a non-empty variable, or a secret's name in the list `GET /api/v1/secrets` returns.
- The person pastes tokens themselves. The skill never runs `claude setup-token` on the person's behalf and never reads the
  token it prints.
- Before telling the person to put a value in `.env`, the skill runs `git check-ignore -q .env` and stops if the file is not
  ignored. Today `.gitignore` ignores `.env*.local` but not `.env`; see Q2.
- The skill files themselves contain placeholders only (`<KILN_PUBLIC_URL>`, `<token>`), never a real-looking token.

### Docs

[Self-hosting](../site/infrastructure/self-hosting.md) gets a **Guided setup** subsection under **Install** that says: clone the
repository, run `claude`, type `/kiln-setup`, and links to `skills/kiln-setup/SKILL.md`. `pnpm docs:gen` regenerates `llms-full.txt`.

## Constraints

- Markdown files and one test; no engine, API or web change. Skill bodies stay short (checks and links, not copied docs) so the
  whole change stays under ~400 lines.
- The GitHub step must not create or suggest any identity with merge or approve permission (ADR-0008, CLAUDE.md).
- Names and paths in the skills come from the code and docs as they are today: `/oauth/linear/callback`, `/webhooks/linear`,
  `/api/v1/forge/repositories`, `/api/v1/connections`, `/api/v1/secrets`, `/create`, `pnpm health`, `pnpm smoke:claude`.
- A test under `scripts/` (vitest already includes `scripts/**/*.test.ts`) checks the skill files statically. No test runs a
  real setup.

## Acceptance criteria

- **AC1.** `skills/kiln-setup/SKILL.md` exists, has `name: kiln-setup` and a `description`, names all seven sub-skills in the
  order above, and tells the agent to run each sub-skill's check and continue only when it passes. _Test:_ parse the file with
  Kiln's frontmatter reader; assert the name, the description and that the body lists the seven sub-skill names in order and
  contains the words "check" and "only" in the continue-rule.
- **AC2.** Each sub-skill file exists with `name` equal to its directory name and a non-empty `description`, and has the sections
  **Do**, **Check** and **If the check fails**. _Test:_ for each of the seven directories, parse the file and assert the headings.
- **AC3.** Every skill file parses with the same parser Kiln uses for factory skills, so a factory could install them unchanged.
  _Test:_ `readFrontmatter` (or the definitions parser's skill branch) returns frontmatter with `name` and `description` and
  no error for each file.
- **AC4.** The orchestrator asks whether the deployment is local or a server (Coolify or Docker), and the prerequisites,
  claude-auth, public-url and github sub-skills each carry a **Local** and a **Server** variant. _Test:_ assert the orchestrator
  body mentions both "local" and "Coolify", and that those four sub-skills contain both headings.
- **AC5.** No secret is printed or committed: every skill body contains the no-secrets rule (never print, log or commit a secret;
  presence-only checks), the claude-auth sub-skill tells the person to run `claude setup-token` themselves, and no skill file
  contains a real-looking token. _Test:_ assert each body contains "never print" (or the agreed phrase); grep all skill files
  against token patterns (`sk-ant-`, `ghp_`, `github_pat_`, `lin_api_`, `lin_wh_`, 40+ hex characters) and assert no match.
- **AC6.** Before any value goes into `.env`, the skill checks that `.env` is git-ignored, and this repository's `.gitignore`
  ignores `.env`. _Test:_ the claude-auth and public-url bodies contain `git check-ignore`; `git check-ignore -q .env` exits 0
  in the repository.
- **AC7.** The Linear sub-skill states the redirect URL `<KILN_PUBLIC_URL>/oauth/linear/callback`, the webhook URL
  `<KILN_PUBLIC_URL>/webhooks/linear`, the three webhook categories (Issues, Comments, Agent session events), the three
  variables, and a check against `GET /api/v1/connections`. _Test:_ assert each string appears in the body.
- **AC8.** The GitHub sub-skill offers the one-click app (**Integrations → GitHub → Create GitHub App**) and the by-hand path,
  says not to give the app a branch-protection bypass, and checks `GET /api/v1/forge/repositories`. _Test:_ assert each string
  appears; assert the body does not contain "bypass" except in that warning (no sentence grants merge or approve rights).
- **AC9.** The factory sub-skill takes a list of `owner/name` repositories, uses `create_factory` with `dry_run` first (or the
  web wizard at `/create`), and checks with `list_factories`. _Test:_ assert the strings `owner/name`, `create_factory`,
  `dry_run`, `/create` and `list_factories` appear.
- **AC10.** The first-issue sub-skill creates a test issue on GitHub (mention `@kiln-factory` with the `factory:<alias>` label)
  or Linear (delegate to the app), checks `list_tasks` for the task and reports the run link under `<KILN_WEB_URL>/runs/`.
  _Test:_ assert each string appears.
- **AC11.** `docs/site/infrastructure/self-hosting.md` has a **Guided setup** subsection under **Install** that links to
  `skills/kiln-setup/SKILL.md` and names `/kiln-setup`, and `docs/site/llms-full.txt` is regenerated. _Test:_ assert the link
  and the heading exist in the page; `pnpm docs:gen` produces no diff after the change is committed.
- **AC12.** `/kiln-setup` and its sub-skills are discoverable by Claude Code in a fresh clone, that is, `.claude/skills/kiln-setup*/SKILL.md`
  resolve to the same content as `skills/kiln-setup*/SKILL.md`. _Test:_ for each skill, read both paths and assert equal content.
  (How they are linked is Q1.)

## Open questions

- **Q1. How do the skills reach `.claude/skills/`?** The issue puts them at `skills/kiln-setup/SKILL.md`, but Claude Code only
  loads `.claude/skills/<name>/SKILL.md` from a project. Options: (a) git symlinks `.claude/skills/kiln-setup*` →
  `../../skills/kiln-setup*` (simplest, but symlinks need `core.symlinks` on Windows); (b) make `skills/` a Claude Code plugin
  with `.claude-plugin/plugin.json`, installed with `claude --plugin-dir .`; (c) keep the canonical files under `.claude/skills/`
  and drop the root `skills/` directory the issue names. Default if nobody answers: (a).
- **Q2. Add `.env` to `.gitignore` in this change?** AC6 needs it. It is a one-line change outside the skill files, and
  `docker-compose.prod.yml` and the docs already tell people to put secrets in `.env`. Default: yes, in this PR.
- **Q3. Should the local path recommend a specific tunnel?** The docs do not name one. Default: show `cloudflared` as the
  example and say any HTTPS tunnel works.
- **Q4. Linear by API key.** The docs mention `LINEAR_API_KEY` and `LINEAR_TEAM_ID` for tracker features, in addition to the
  OAuth app. Should the sub-skill ask for them too, or only the OAuth app and webhook (which agent sessions need)? Default: ask
  for the OAuth app and webhook; mention the API key as optional for planning and state changes.
- **Q5. Size.** Seven sub-skills plus the orchestrator, a test and the docs edit should fit in ~400 lines if bodies stay to
  about 30 lines. If they do not, split Linear and GitHub into a second PR.
