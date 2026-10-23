# ADR-013: One voice session whose scope widens on demand

Status: Accepted · Date: 2026-10-22 · Revised 2026-10-23 (GPT-Live)

## Context

People want to talk to Studio (ADR-012): sometimes just to dictate a message, sometimes to have a spoken conversation with the chat they're in, and sometimes to work without touching anything, moving between Apps and chats while agents work. A separate "hands-free mode" you must switch into puts a wall between talking to one chat and working across everything, and people won't find the bigger abilities. Coding turns take minutes, so a voice model has to be told when things happen rather than poll, and it must not talk over the person.

## Decision

**Three levels, one session.**

- **Dictation.** The mic in a chat composer turns speech into text in the box. It uses speech-to-text only, no realtime model, and belongs to Studio.
- **Talk to this chat.** The talk button starts a realtime voice session focused on the current chat. The person's words go to that chat's agent; the session reads back turn summaries and the agent's questions.
- **Wider scope on demand.** There is no hands-free mode to switch into. When the person asks about another chat or App ("how's Daily Done?", "start another chat for this"), the same session reaches there and says briefly that it did ("opening Daily Done"). Later, the same session can read factory status and the Inbox.

**The hands-free screen is a view, not a mode.** A layout with a big preview of the focus, the transcript and the needs-you list. It opens when the person asks for it or when the session starts moving between Apps; the person can also stay on the normal Studio screen.

**GPT-Live talks; Kiln thinks.** The voice is OpenAI's full-duplex GPT-Live (`gpt-live-1`): it listens while it speaks and handles turn-taking itself. It does no reasoning of its own about Studio. Every request it can't answer from what it was told is handed to Kiln (client delegation), and Kiln decides and acts. No OpenAI backend model runs.

- **The conductor is fast, not a foreman turn.** A foreman turn (ADR-011) is a sandboxed agent run and takes far too long for speech. Kiln's conductor is one tool-use call to the decision model (ADR-006: `KILN_DECISION_MODEL`, Claude Haiku by default) with the Studio tools from ADR-012, started the moment GPT-Live delegates. The call is kept small so it answers in well under a second: a cached system prompt and tool list, a `relay` tool that names only the target chat (Kiln fills in the words), and Kiln acts as soon as the tool calls are complete, without waiting for the end of the stream.
- **A conductor, not a coder.** The conductor never edits code. It calls the Studio tools (server tools such as `send`, `new_chat`, `apply`; client tools `focus` and `show` that move the screen), like every other client.
- **Relay, don't paraphrase.** The conductor chooses _where_ words go, never _what_ they say: Kiln sends the person's transcribed words to the chat verbatim, with routing context only (which chat, which element they pointed at).
- **Interruptions follow event priority.** _Needs you_ is given to GPT-Live as something to say, and GPT-Live says it at the next pause, never over the person. _Finished_ is a badge, spoken only when the person is idle or the event is in the focused chat; otherwise GPT-Live is told quietly, so it can answer "how's it going?". _Progress_ is never spoken. Quiet mode turns everything into badges.
- **Spoken confirmation** before Apply, Restore or Ship.
- **Reading, not diffs.** The session reads each turn's title and short summary, which Studio writes anyway, and can `look` at a preview.

**Plumbing.** A `VoiceProvider` interface in `packages/voice`, with a fake; GPT-Live is the first adapter. The browser sends its WebRTC offer to Kiln's API, which creates the GPT-Live session with the team's OpenAI model key (ADR-007) and returns the answer, so no key or token reaches the browser. The API holds the sideband connection to the session: delegations, transcripts and the spoken updates go through it, so Kiln is the only owner of every action. The session's transcript and focus are runtime state in the Store, so a dropped connection or a new tab resumes where it was.

**Factories are read-only by voice.** Deciding a gate or approving anything in a factory by voice needs its own ADR.

## Consequences

- New package `packages/voice`. The API gains a voice route module (`apps/api/src/routes/voice.ts`); `app.ts` doesn't change.
- Voice depends only on the Studio tools and events. With a fake provider, a fake thinker and scripted transcripts, routing, focus and interruption rules can be tested without audio.
- Latency budget: the conductor's model call is the only wait between the person's words and the action. GPT-Live acknowledges out loud while it waits, so the person never hears silence.
- The voice track starts with "talk to this chat", which is useful alone and needs the fewest tools, then widens scope, then adds factories and the Inbox.
- GPT-Live is billed per second of session ($0.05 a minute at launch), the conductor per call. Sessions stop listening when idle and end after 30 minutes of talk, counted across resumes; that length limit is the session's spend limit.
- Uploads (a logo, a screenshot) can't be done by voice; the screen shows a drop zone.
