# Idea: talk to Studio

Status: idea, not scheduled · Raised 2026-10-22 · Decision record: [ADR-013](../adr/0013-voice.md) (proposed) · Builds on [Studio](studio.md)

## The idea

You can talk to Studio at whatever depth you want, and there is no mode to switch into. Start by talking to the chat you're in. When you ask for more, the same voice reaches further: another chat, another App, and later your factories.

## Three levels, one session

| Level             | How it starts               | What it does                                                                                               |
| ----------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Dictation         | Tap the mic in the composer | Speech becomes text in the box                                                                             |
| Talk to this chat | The talk button in a chat   | A spoken conversation with that chat: your words go to its agent, and you hear its summaries and questions |
| Wider scope       | Nothing; just ask           | The same session reaches other chats and Apps, and says so ("opening Daily Done")                      |

The hands-free screen (a big preview, the transcript, the needs-you list) is a view, not a mode. It opens when you ask for it, or when the voice starts moving you between Apps.

## What it feels like

> You're talking to the logo chat: "Make it a bit bigger." — it goes to that chat.
> "How's it going with Daily Done?" — it summarizes and opens the App with its preview.
> "Spawn another chat and add due dates there." — a new chat starts and your screen follows; the first chat keeps working.
> _(later, at a pause)_ "By the way, the checkout chat has a question." — "Who needs me?" — it reads the question and switches there.

## Rules

- **A conductor, not a coder.** The voice model never edits code. It calls the same Studio tools as the web UI and Claude Code.
- **Relay, don't paraphrase.** Your words reach the coding agent as you said them, plus routing context.
- **When to speak.** "Needs you" at the next pause, never over you. "Finished" is a badge, spoken only when you're idle or it's the chat you're in. Progress stays silent. Quiet mode turns everything into badges.
- **It confirms out loud** before Apply, Restore or Ship.
- **Sessions resume.** The conversation and the focus are stored on the server.
- **Uploads** need the screen: it shows a drop zone.
- **Factories are read-only by voice** until a separate decision allows more.

## Phases

1. **Dictation** in the composer (ships with Studio's phase 2).
2. **Talk to this chat.** `VoiceProvider`, the OpenAI Realtime adapter, the browser client, relaying and spoken summaries.
3. **Wider scope.** Focus and client tools, spoken "needs you" events, the hands-free view, resumable sessions.
4. **Factories and the Inbox**, read-only.

Phases 2–4 need Studio's control surface (Studio phase 4) first.

## Open questions

- Push-to-talk, an open mic with voice detection, or both.
- Which voice providers come after OpenAI Realtime.
- Whether the voice session should be reachable from a phone while away from the screen.

## Related

- [Studio](studio.md)
- [ADR-012: Studio](../adr/0012-studio.md)
- [ADR-013: Voice](../adr/0013-voice.md)
