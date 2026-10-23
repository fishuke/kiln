import { randomBytes } from "node:crypto";
import type { Store } from "@kiln/store";
import { VOICE_LIMITS, VoiceError, VoiceSession, type Clock, type Focus, type TranscriptLine, type VoiceCommand } from "./types";

/** Store collection; runtime state only (ADR-013: a dropped connection or a new tab resumes from here). */
export const VOICE_SESSIONS = "voice_sessions";

export type NewVoiceSession = { team: string; by: string; focus?: Focus; quiet?: boolean; liveSessionId?: string };
export type VoiceSessionPatch = Partial<Pick<VoiceSession, "liveSessionId" | "status" | "focus" | "quiet" | "pending" | "seconds" | "costUsd">>;

/** Voice sessions in the Store; every write is validated and stamped from the injected clock. */
export class VoiceSessionStore {
  constructor(
    private readonly store: Store,
    private readonly clock: Clock,
  ) {}

  create(input: NewVoiceSession): VoiceSession {
    const at = this.clock.now().toISOString();
    const session = VoiceSession.parse({
      id: `vs_${randomBytes(16).toString("hex")}`,
      team: input.team,
      by: input.by,
      ...(input.liveSessionId ? { liveSessionId: input.liveSessionId } : {}),
      status: "connecting",
      focus: input.focus ?? {},
      quiet: input.quiet ?? false,
      transcript: [],
      seconds: 0,
      costUsd: 0,
      createdAt: at,
      updatedAt: at,
    });
    return this.store.put(VOICE_SESSIONS, session);
  }

  get(id: string): VoiceSession | undefined {
    return this.store.get<VoiceSession>(VOICE_SESSIONS, id);
  }

  /** Sets the given fields; `pending: undefined` clears a pending confirmation. */
  update(id: string, patch: VoiceSessionPatch): VoiceSession {
    const session = VoiceSession.parse({ ...this.must(id), ...patch, updatedAt: this.clock.now().toISOString() });
    if (session.pending === undefined) delete session.pending;
    return this.store.put(VOICE_SESSIONS, session);
  }

  /** Adds a line and keeps the last VOICE_LIMITS.transcriptLines. */
  appendTranscript(id: string, line: Omit<TranscriptLine, "at">): VoiceSession {
    const session = this.must(id);
    const at = this.clock.now().toISOString();
    const transcript = [...session.transcript, { ...line, at }].slice(-VOICE_LIMITS.transcriptLines);
    return this.store.put(VOICE_SESSIONS, VoiceSession.parse({ ...session, transcript, updatedAt: at }));
  }

  private must(id: string): VoiceSession {
    const session = this.get(id);
    if (!session) throw new VoiceError("not_found", `unknown voice session ${id}`);
    return session;
  }
}

/**
 * What a resumed session's new live session is told first: the conversation so far and the focus, as
 * `think`, so the voice carries on without saying it again. Undefined when there is nothing to carry over.
 */
export function resumeSeed(session: VoiceSession): VoiceCommand | undefined {
  const { app, chat } = session.focus;
  const lines = session.transcript.map((l) => `${l.role === "person" ? "Person" : "You"}: ${l.text}`);
  const focus = app ? `The person is looking at app ${app}${chat ? `, chat ${chat}` : ""}.` : undefined;
  if (!lines.length && !focus) return undefined;
  const text = [...(lines.length ? ["The conversation so far (resumed):", ...lines] : []), ...(focus ? [focus] : [])].join("\n");
  return { type: "think", text, delegation: null };
}
