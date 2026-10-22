# Idea: Studio, vibe coding next to factories

Status: idea, not scheduled · Raised 2026-10-20, reworked 2026-10-22 · Decision record: [ADR-012](../adr/0012-studio.md) (proposed) · Replaces "product-owner chat with a fast preview"

## The idea

Talk to one model and watch the app change on the right, like chat-to-preview tools. Start something new from a template, or open an existing app from GitHub and change it. Run several lines of work at once, and talk to it if you like. When a change is ready, ship it as a pull request that someone reviews and merges. Couple the App to a factory when you want automation around it, such as checks when a pull request opens or deploy monitoring after a merge.

Studio sits next to factories, not inside them. An App works without a factory.

## Building blocks

```
Team
 └─ Kiln Project (optional)   groups Apps and factories; shared environments
     └─ App          one repo + one sandbox (from a template or an imported repo); main line = Versions
         └─ Chat      own git worktree + branch + dev server port + live preview
             └─ Lead agent   one harness session, model of your choice, steered by each message
                 └─ Subagents  spawned by the harness inside the same worktree
```

- **App.** A Git repository in one sandbox.
  - **From a template:** dependencies are already installed in the runner image, so the first preview is up in about ten seconds.
  - **Imported from GitHub:** Kiln clones the repository, picks the package manager from the lockfile, installs on first open (snapshots keep later opens fast), and runs `scripts.dev` (you can override it). It asks for any environment variables the app needs to boot.
- **Kiln Project.** Groups Apps and factories, for example _Saba_: the frontend App and the backend factory. Its **environments** (variables and secrets, such as the API URL a preview should use) are inherited by its Apps' previews and its factories' runs. Each layer can override: team → project → App or factory.
- **Chat.** A parallel line of work ("pricing page" while "fix login" runs). Each chat has its own preview, so chats don't overwrite each other.
- **Subagents** belong to a chat. The lead agent spawns them through its harness; Studio shows them as nested activity.
- Idle chats pause using sandbox snapshots, and an App has a limit on how many chats run at once.

## Versions

- A turn that **changes files** makes a checkpoint on its chat's branch. A turn that **changes nothing**, such as a question, makes nothing, whatever the mode.
- **Apply** merges a chat into the App's main line and records a version with a short title ("Added drag-to-order"). In chat it appears as a card with **Details** (the diff) and **Preview**.
- **History** lists the versions, and **Bookmarks** the ones you pinned. Previewing an old version shows it with a **Previewing** banner, **Restore** and **Back to latest**. Restore makes a new version, so nothing is lost.

## Ship modes

| Mode   | Apply                                                        | On GitHub                                                                         |
| ------ | ------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| Safe   | You click Apply                                              | Nothing is pushed until you ask                                                   |
| Review | You click Apply                                              | The agent opens a pull request from a `studio/<app>` branch; a person merges      |
| Cowboy | Automatic after every turn that changes files, in every chat | Template App: the agent pushes main. Imported App: only the `studio/<app>` branch |

- A template App defaults to **Cowboy**: it's an experiment, so who cares. An imported App defaults to **Review**. No agent ever pushes to an imported repository's main branch.
- Cowboy pushing main is the only place an agent merges, and only on the repository Kiln created for a template App, until that App is linked to a factory ([ADR-012](../adr/0012-studio.md)).

## From Studio to a reviewed pull request

This mirrors how a customer and a developer already work together in a tracker:

1. A customer opens the App in Studio, asks for a change and sees it in the preview.
2. **Ship** (or Review mode) opens a pull request. The App shows its state: **UAT**.
3. The customer tests it in the built-in preview, and in the pull request's deployment preview if one is configured. More messages keep updating the same pull request.
4. The customer marks it **Ready for review**, or **Cancels** it: the pull request closes and no reviewer is bothered. An open pull request alone is never treated as ready.
5. The App's **merge gate** ([ADR-014](../adr/0014-merge-gate.md)) checks it. If it's safe to merge, Kiln merges it and you're not asked. If not, it lands in your Inbox for review.
6. The customer sees every step in Studio: UAT, Ready for review, merged, or waiting for review.

Each App's policy caps the ship mode per role: a customer can use Cowboy on an App they created, and only Review on your production App. Who may open, ship or review an App is part of the separate roles plan.

## Apps and factories

Studio sits in Kiln's sidebar next to Factories, and an App is a sibling of a factory, built from the same definitions: the agent and model, skills (some mandatory for that App), MCPs, policies, decisions and budgets. A new App starts with defaults from the team and the Kiln Project, so nobody configures anything to begin.

An App can be linked to a factory, but doesn't have to be. When it is:

- The factory's automations run on the App's pull requests like on any other: `pull_request_opened` for checks, `pull_request_merged` for deploy follow-up and monitoring (see [Factories after merge](factory-deployments.md)).
- Merges into that repository follow ADR-008 and the merge gate.
- **Turn into factory** on a template App creates a factory pointed at its repository and writes a project brief from the chats and bookmarked versions.


## Modes

Modes control what the agent may do, not whether a version is made.

| Mode  | The agent may                | Notes                                             |
| ----- | ---------------------------- | ------------------------------------------------- |
| Build | read, edit, run              | Still just answers when no change is needed.      |
| Chat  | read                         | Can use a cheaper, faster model.                  |
| Plan  | read, then write a plan card | **Build it** runs the plan here or in a new chat. |

## Live preview

- `Sandbox.expose(port)` lets the API proxy each chat's dev server, with hot reload.
- Previews are served from their own origin (`sc-<id>.<preview domain>`), never from Kiln's own, preferably on a separate domain, so generated code can't read or set Kiln's cookies or call its API.
- The preview pane has Preview and Code tabs, a route picker, reload and "open in a new tab".

## One control surface

Every Studio action is a typed tool, available through the API and the Kiln MCP. The web UI, Claude Code and voice all use the same tools.

| Tool                                                   | Kind   | What it does                                                                       |
| ------------------------------------------------------ | ------ | ---------------------------------------------------------------------------------- |
| `status`                                               | server | What is running and what is waiting on you, for one App or all of them             |
| `open_app`, `new_chat`                                 | server | Start or open work                                                                 |
| `send(chat, text)`                                     | server | Prompt or steer a chat's agent                                                     |
| `apply`, `restore`, `bookmark`                         | server | Manage versions                                                                    |
| `ship`                                                 | server | Open or update the App's pull request, or mark it Ready for review or Cancelled |
| `look(chat)`                                           | server | A screenshot of the preview                                                        |
| `focus(app, chat)`, `show(preview \| code \| history)` | client | Move your screen                                                                   |

- **Focus** is the App and chat you're looking at, and the default target of a message. "Add a logo" needs no name.
- Studio events go on the event bus with a priority: **needs you** (an agent asks something), **finished** (a turn or chat is done), **progress**. The top bar shows a badge for anything that needs you.

## Voice

Every chat composer has a mic for **dictation**. Talking to a chat, and moving between chats and Apps by voice, is a separate idea: see [Voice](voice.md) and [ADR-013](../adr/0013-voice.md).

## Phases

1. **ADR and spec.** [ADR-012](../adr/0012-studio.md), and the contract in `docs/specs/studio.md`.
2. **A one-chat MVP.** `Sandbox.expose`, the preview proxy, the Next.js template and runner image, importing a GitHub repo, one chat per App, versions, History and Bookmarks, the modes, dictation.
3. **Several chats.** Worktrees, a preview per chat, Apply with conflict resolution, subagent activity in the UI.
4. **Control surface.** `studio.*` API and MCP tools, focus and client tools, events with priorities, the attention badge.
5. **Shipping and the merge gate.** Pushing per ship mode, ship-mode caps per role, pull requests from Studio, UAT → Ready for review → merge gate (merge, or review in the Inbox), Cancel, and the status visible to the author.
6. **Projects and factories.** Apps in Kiln Projects, project environments, App definitions (agents, mandatory skills, MCPs, policies), linking an App to a factory, Turn into factory.
7. **Several repositories in one App.** Run a frontend and its backend in one sandbox, wire the frontend to the local backend, and ship linked pull requests under one review. This fixes previews that hit the live API because the backend change isn't deployed yet.

Voice is its own track; see [Voice](voice.md).

## Open questions

- Which model each mode uses by default, and whether an App can mix harnesses across chats.
- Budgets: a spend limit per App, and what happens when it is reached mid-turn.
- How a design system or existing components are made available so previews look like the product.
- Who an App's reviewers are by default: the linked factory's people, otherwise the App's owner.

## Related

- [ADR-012: Studio](../adr/0012-studio.md)
- [Voice](voice.md)
- [Factories after merge](factory-deployments.md)
- [Sandboxes](../site/infrastructure/sandboxes.md)
- [Previews](../site/integrations/previews.md)
- [Portfolio and projects](../site/management/portfolio.md)
