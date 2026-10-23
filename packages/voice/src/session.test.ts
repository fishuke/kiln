import { MemoryStore } from "@kiln/store";
import { describe, expect, it } from "vitest";
import { resumeSeed, VoiceSessionStore } from "./session";
import { VOICE_LIMITS, VoiceError, VoiceSession } from "./types";

const clockAt = (iso: string) => {
  const c = { t: new Date(iso), now: () => c.t };
  return c;
};

describe("VoiceSessionStore", () => {
  it("creates a session in voice_sessions with times from the clock", () => {
    const store = new MemoryStore();
    const sessions = new VoiceSessionStore(store, clockAt("2026-10-23T10:00:00.000Z"));
    const s = sessions.create({ team: "t1", by: "u1", focus: { app: "a1", chat: "c1" } });
    expect(VoiceSession.parse(s)).toEqual(s);
    expect(s).toMatchObject({
      team: "t1",
      by: "u1",
      status: "connecting",
      quiet: false,
      transcript: [],
      seconds: 0,
      costUsd: 0,
      createdAt: "2026-10-23T10:00:00.000Z",
    });
    expect(s.id).toMatch(/^vs_/);
    expect(store.get("voice_sessions", s.id)).toEqual(s);
    expect(sessions.get(s.id)).toEqual(s);
    expect(sessions.get("nope")).toBeUndefined();
  });

  it("updates fields and stamps updatedAt; an unknown session is not_found", () => {
    const clock = clockAt("2026-10-23T10:00:00.000Z");
    const sessions = new VoiceSessionStore(new MemoryStore(), clock);
    const s = sessions.create({ team: "t1", by: "u1" });
    clock.t = new Date("2026-10-23T10:01:00.000Z");
    const next = sessions.update(s.id, { status: "live", liveSessionId: "live_1", focus: { app: "a2" } });
    expect(next).toMatchObject({
      status: "live",
      liveSessionId: "live_1",
      focus: { app: "a2" },
      createdAt: "2026-10-23T10:00:00.000Z",
      updatedAt: "2026-10-23T10:01:00.000Z",
    });
    expect(sessions.get(s.id)).toEqual(next);
    expect(() => sessions.update("nope", { quiet: true })).toThrow(VoiceError);
  });

  it(`keeps only the last ${VOICE_LIMITS.transcriptLines} transcript lines`, () => {
    const sessions = new VoiceSessionStore(new MemoryStore(), clockAt("2026-10-23T10:00:00.000Z"));
    const s = sessions.create({ team: "t1", by: "u1" });
    for (let i = 0; i < VOICE_LIMITS.transcriptLines + 5; i++) sessions.appendTranscript(s.id, { role: i % 2 ? "voice" : "person", text: `line ${i}` });
    const { transcript } = sessions.get(s.id)!;
    expect(transcript).toHaveLength(VOICE_LIMITS.transcriptLines);
    expect(transcript[0]).toEqual({ role: "voice", text: "line 5", at: "2026-10-23T10:00:00.000Z" });
    expect(transcript.at(-1)!.text).toBe(`line ${VOICE_LIMITS.transcriptLines + 4}`);
  });
});

describe("resumeSeed", () => {
  it("seeds a resumed live session with the transcript and focus as think", () => {
    const sessions = new VoiceSessionStore(new MemoryStore(), clockAt("2026-10-23T10:00:00.000Z"));
    const s = sessions.create({ team: "t1", by: "u1", focus: { app: "a1", chat: "c1" } });
    sessions.appendTranscript(s.id, { role: "person", text: "make the header blue" });
    sessions.appendTranscript(s.id, { role: "voice", text: "Sent." });
    const seed = resumeSeed(sessions.get(s.id)!);
    expect(seed).toMatchObject({ type: "think", delegation: null });
    expect(seed!.type === "think" && seed!.text).toContain("Person: make the header blue");
    expect(seed!.type === "think" && seed!.text).toContain("You: Sent.");
    expect(seed!.type === "think" && seed!.text).toContain("app a1, chat c1");
  });

  it("has nothing to seed for an empty session without focus", () => {
    const sessions = new VoiceSessionStore(new MemoryStore(), clockAt("2026-10-23T10:00:00.000Z"));
    expect(resumeSeed(sessions.create({ team: "t1", by: "u1" }))).toBeUndefined();
  });
});
