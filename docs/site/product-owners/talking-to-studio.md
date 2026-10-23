---
title: Talking to Studio
description: Press Talk in a Studio chat to have a spoken conversation with its agent through OpenAI's GPT-Live, reach other chats and Apps by asking, and work hands-free.
owner: docs
section: Product owners
---

Press **Talk** in a Studio chat and speak: your words go to that chat's agent as you said them, and you hear its summaries and questions.

## Three ways to use your voice

| Level             | How it starts             | What it does                                                          |
| ----------------- | ------------------------- | --------------------------------------------------------------------- |
| Dictation         | The mic in the composer   | Speech becomes text in the box. You still press send.                 |
| Talk to this chat | **Talk**, next to the mic | A spoken conversation with the chat you're in                         |
| Wider scope       | Nothing; just ask         | The same session reaches other chats and Apps, and says where it went |

There is no mode to switch into. The decision is [ADR-013](https://github.com/fishuke/kiln/blob/main/docs/adr/0013-voice.md).

## Start and end a session

1. Open a chat in a Studio App and press **Talk**.
2. Allow the microphone when the browser asks.
3. The button shows **Connecting**, then pulses while the session is live.
4. Speak normally. You can talk over the voice; it stops and listens.
5. Press **Mute** to stop sending your voice, or **End** to close the session.

The session ends by itself after 30 minutes. After 2 minutes without you speaking it stops listening and shows **Idle**; speak or move to another chat to wake it.

If you reload the page, the session picks up where it was, with the same transcript and focus.

## What to say

| You say                                                | What happens                                                |
| ------------------------------------------------------ | ----------------------------------------------------------- |
| "Make the logo a bit bigger."                          | Your words go to the chat you're in, word for word.         |
| "How's it going with Daily Done?"                      | It reads that App's status and opens it.                    |
| "Start another chat and add due dates there."          | A new chat starts with your words, and your screen follows. |
| "Who needs me?"                                        | It reads the question that is waiting and moves you there.  |
| "Show me the code." / "Show the history."              | Your screen switches view.                                  |
| "Go hands-free."                                       | The hands-free view opens.                                  |
| "Apply it." / "Restore the last version." / "Ship it." | It asks you to confirm first. Say "yes" to go ahead.        |

The voice never writes code. It picks which chat your words go to and calls the same Studio tools as the web UI and [Kiln MCP](../developer-tools/mcp.md). It never rewords what you said for the agent.

Turns you sent by voice show a mic icon in the chat.

You can't upload files by voice. Drop a logo or a screenshot on the screen instead.

## When the voice speaks

| Event                                                       | What you hear                                                |
| ----------------------------------------------------------- | ------------------------------------------------------------ |
| A chat needs you (it asks a question)                | It says so at the next pause, never over you.                |
| A turn finished in the chat you're in, or while you're idle | Its title and short summary                                  |
| A turn finished in another chat                             | Nothing. A badge appears, and you can ask "how's it going?". |
| Progress while an agent works                               | Nothing                                                      |

### Quiet mode

Turn on **Quiet** to stop the voice from speaking on its own. Everything becomes a badge, and it still answers when you ask.

## The hands-free view

The hands-free view shows a big preview of the chat in focus, the live transcript and the list of chats that need you. It opens when you ask for it, or the first time the voice moves you to another App. It has the quiet toggle and **End**. A button takes you back to the normal screen; the session keeps going.

## The OpenAI key

Voice uses OpenAI's GPT-Live (`gpt-live-1`). Kiln creates each session with the team's OpenAI model key, `KILN_MODEL_OPENAI`, and falls back to the server's `OPENAI_API_KEY`. The key stays on the server; the browser never sees it.

With neither set, **Talk** shows an error with a link to **Team settings → Model keys**. A team owner or admin adds the key there. See [Team-managed model keys](../management/secrets-mcps-environments.md#team-managed-model-keys).

Kiln decides what to do with what you say using the decision model, `KILN_DECISION_MODEL` (Claude Haiku by default), through `LLM_GATEWAY_URL` or an Anthropic key. See [Typed decisions](../configuration/decisions.md).

## Costs

- **GPT-Live** bills per second of session, $0.05 a minute at launch, on your OpenAI key. Kiln records each session's usage when it closes.
- **The decision model** bills per call: one short call each time you ask for something.
- The coding turns your words start cost what any Studio turn costs.

Sessions stop listening when idle and end after 30 minutes, so a forgotten tab doesn't keep billing.

## Limits

- Factories and the Inbox can't be used by voice yet.
- No uploads, phone calls or custom voices.

## API

| Method   | Path                                 | What it does                                                                                             |
| -------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| `POST`   | `/api/v1/voice/sessions`             | Starts a session from the browser's WebRTC offer. Answers 409 `no_openai_key` when no OpenAI key is set. |
| `GET`    | `/api/v1/voice/sessions/{id}/events` | Server-sent events: screen moves, transcript lines, badges and state.                                    |
| `PATCH`  | `/api/v1/voice/sessions/{id}`        | Sets the focus or quiet mode.                                                                            |
| `DELETE` | `/api/v1/voice/sessions/{id}`        | Ends the session.                                                                                        |

Writes need the `send` scope and the event stream needs `read`. See the [API reference](../developer-tools/api.md).

## Related pages

- [Studio App definitions](../configuration/studio-app-definitions.md)
- [Previews](../integrations/previews.md#studio-live-previews)
- [Secrets, MCP servers and environments](../management/secrets-mcps-environments.md)
- [Typed decisions](../configuration/decisions.md)
- [Kiln MCP](../developer-tools/mcp.md)
- [Working as a product owner](workspace.md)
