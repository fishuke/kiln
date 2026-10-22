# Idea: Studio, vibe coding that graduates into a factory

Status: idea, not scheduled · Raised 2026-10-20, reworked 2026-10-22 · Decision record: [ADR-012](../adr/0012-studio.md) (proposed) · Replaces "product-owner chat with a fast preview"

## The idea

Before a project is ready for a factory, you want to talk to one model and watch the app appear on the right, like chat-to-preview tools. Studio is that space. Describe an app, see it running in seconds, keep changing it, run several lines of work at once, and talk to it if you like. When the project matures, **Turn into factory** gives it a repository and a factory that builds and maintains features with the usual gates and reviews.

Studio sits next to factories, not inside them: no spec, no gates, no pull requests until the project graduates.

## Building blocks

```
Workspace
 └─ Project        one repo + one sandbox (template: Next.js); main line = Versions
     └─ Chat        own git worktree + branch + dev server port + live preview
         └─ Lead agent   one harness session, model of your choice, steered by each message
             └─ Subagents  spawned by the harness inside the same worktree
```

- **Project.** A Git repository in one sandbox, started from a template with dependencies already installed in the runner image, so the first preview is up in about ten seconds.
- **Chat.** A parallel line of work ("pricing page" while "fix login" runs). Each chat has its own preview, so chats don't overwrite each other.
- **Subagents** belong to a chat. The lead agent spawns them through its harness; Studio shows them as nested activity.
- Idle chats pause using sandbox snapshots, and a project has a limit on how many chats run at once.

## Versions

- A turn that **changes files** makes a checkpoint on its chat's branch. A turn that **changes nothing**, such as a question, makes nothing, whatever the mode.
- **Apply** merges a chat into the project's main line and records a version with a short title ("Added drag-to-order"). In chat it appears as a card with **Details** (the diff) and **Preview**.
- When Apply happens depends on the project's **ship mode**:

  | Mode             | Apply                                                                                                          | The project's GitHub repository           |
  | ---------------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
  | Safe             | You click Apply                                                                                                | Nothing is pushed until you ask           |
  | Review           | You click Apply                                                                                                | The agent opens a pull request; you merge |
  | Cowboy (default) | Automatic after every turn that changes files, in every chat; on a conflict the chat's agent resolves it first | The agent pushes main                     |

  Cowboy is fine because Studio projects are experiments. The agent's push token only reaches that one Studio repository, and graduating into a factory ends Cowboy: from then on the factory's rules apply and a person merges ([ADR-012](../adr/0012-studio.md)).

- **History** lists the versions, and **Bookmarks** the ones you pinned. Previewing an old version shows it in the preview with a **Previewing** banner, **Restore** and **Back to latest**. Restore makes a new version, so nothing is lost.

## Modes

Modes control what the agent may do, not whether a version is made.

| Mode  | The agent may                | Notes                                             |
| ----- | ---------------------------- | ------------------------------------------------- |
| Build | read, edit, run              | Still just answers when no change is needed.      |
| Chat  | read                         | Can use a cheaper, faster model.                  |
| Plan  | read, then write a plan card | **Build it** runs the plan here or in a new chat. |

## Live preview

- `Sandbox.expose(port)` lets the API proxy each chat's dev server, with hot reload.
- Previews are served from their own origin (`<id>.preview.<domain>`), never from Kiln's own, so generated code can't read Kiln's cookies or call its API. Local development can use a `localhost` port.
- The preview pane has Preview and Code tabs, a route picker, reload and "open in a new tab".

## One control surface

Every Studio action is a typed tool, available through the API and the Kiln MCP. The web UI, Claude Code and voice all use the same tools.

| Tool                                                       | Kind   | What it does                                                               |
| ---------------------------------------------------------- | ------ | -------------------------------------------------------------------------- |
| `status`                                                   | server | What is running and what is waiting on you, for one project or all of them |
| `open_project`, `new_chat`                                 | server | Start or open work                                                         |
| `send(chat, text)`                                         | server | Prompt or steer a chat's agent                                             |
| `apply`, `restore`, `bookmark`                             | server | Manage versions                                                            |
| `look(chat)`                                               | server | A screenshot of the preview, for the voice model to see                    |
| `focus(project, chat)`, `show(preview \| code \| history)` | client | Move your screen                                                           |

- **Focus** is the project and chat you're looking at, and the default target of a message. "Add a logo" needs no name.
- Studio events go on the event bus with a priority: **needs you** (an agent asks something), **finished** (a turn or chat is done), **progress**. The top bar shows a badge for anything that needs you.

## Voice

Every chat composer has a mic for **dictation**: speech becomes text in the box. Talking to a chat, and moving between chats and projects by voice, is a separate idea that builds on the tools above: see [Voice](voice.md) and [ADR-013](../adr/0013-voice.md).

## Graduation

**Turn into factory** creates a repository on your forge, pushes the main line with its history, creates a factory from a template pointed at that repository, and writes a project brief from the chats and bookmarked versions so the factory's agents know what was built and why. The Studio project becomes read-only. Later, a Studio chat might open pull requests into the factory's repository.

## Phases

1. **ADR and spec.** [ADR-012](../adr/0012-studio.md), and a spec for the packages and API routes.
2. **A one-chat MVP.** `Sandbox.expose`, the preview proxy, the Next.js template and runner image, one chat per project, versions, History and Bookmarks, the three modes.
3. **Several chats.** Worktrees, a preview per chat, Apply with conflict resolution, subagent activity in the UI.
4. **Control surface.** `studio.*` API and MCP tools, focus and client tools, events with priorities, the attention badge.
5. **Voice.** Its own track; see [Voice](voice.md). Dictation ships with phase 2.
6. **Graduation.** Forge repository creation, a factory from a template, the project brief.

The control surface comes before voice on purpose: with the right tools, voice is mostly UI, and the tools can be tested without a microphone.

## Open questions

- Which model each mode uses by default, and whether a project can mix harnesses across chats.
- Budgets: a spend limit per project, and what happens when it is reached mid-turn.
- How a design system or existing components are made available so previews look like the product.
- Sharing: can a teammate open your Studio project or its preview?

## Related

- [ADR-012: Studio](../adr/0012-studio.md)
- [Sandboxes](../site/infrastructure/sandboxes.md)
- [Harnesses](../site/infrastructure/harnesses.md)
- [Previews](../site/integrations/previews.md)
