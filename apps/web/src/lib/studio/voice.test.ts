import { describe, expect, it } from "vitest";
import { INITIAL_VOICE, focusChanged, routeClientAction, startError, voiceReducer, type VoiceState } from "./voice";

const live = (o: Partial<VoiceState> = {}): VoiceState => ({ ...INITIAL_VOICE, phase: "live", sessionId: "vs_1", focus: { app: "sa_1", chat: "sc_1" }, ...o });

describe("voiceReducer", () => {
  it("goes idle → connecting → live when the session starts", () => {
    let s = voiceReducer(INITIAL_VOICE, { type: "start", focus: { app: "sa_1", chat: "sc_1" } });
    expect(s).toMatchObject({ phase: "connecting", focus: { app: "sa_1", chat: "sc_1" } });
    s = voiceReducer(s, { type: "connected", id: "vs_1" });
    expect(s).toMatchObject({ phase: "connecting", sessionId: "vs_1" });
    s = voiceReducer(s, { type: "started" });
    expect(s.phase).toBe("live");
  });

  it("treats a live or idle state from the stream as started", () => {
    const s = voiceReducer(
      { ...INITIAL_VOICE, phase: "connecting", sessionId: "vs_1" },
      { type: "stream", event: { event: "state", data: { status: "idle", focus: { app: "sa_2" }, quiet: true } } },
    );
    expect(s).toMatchObject({ phase: "live", status: "idle", focus: { app: "sa_2" }, quiet: true });
  });

  it("returns to idle when the stream says the session closed, or when it ended", () => {
    expect(voiceReducer(live(), { type: "stream", event: { event: "state", data: { status: "closed", focus: {}, quiet: false } } })).toEqual(INITIAL_VOICE);
    expect(voiceReducer(live({ phase: "ending" }), { type: "ended" })).toEqual(INITIAL_VOICE);
  });

  it("keeps the error and its code, and a new start clears it", () => {
    const s = voiceReducer(live(), { type: "failed", message: "No OpenAI key", code: "no_openai_key" });
    expect(s).toMatchObject({ phase: "error", error: { message: "No OpenAI key", code: "no_openai_key" } });
    expect(s.sessionId).toBeUndefined();
    expect(voiceReducer(s, { type: "start", focus: {} }).error).toBeUndefined();
  });

  it("keeps the last 40 transcript lines", () => {
    let s = live();
    for (let i = 0; i < 45; i++)
      s = voiceReducer(s, { type: "stream", event: { event: "transcript", data: { role: i % 2 ? "voice" : "person", text: `line ${i}` } } });
    expect(s.transcript).toHaveLength(40);
    expect(s.transcript[0]!.text).toBe("line 5");
    expect(s.transcript.at(-1)).toEqual({ role: "person", text: "line 44" });
  });

  it("keeps one badge per chat, newest first", () => {
    let s = live();
    s = voiceReducer(s, { type: "stream", event: { event: "badge", data: { appId: "sa_1", chatId: "sc_1", text: "Finished", priority: "finished" } } });
    s = voiceReducer(s, { type: "stream", event: { event: "badge", data: { appId: "sa_2", chatId: "sc_9", text: "Which color?", priority: "needs_you" } } });
    s = voiceReducer(s, { type: "stream", event: { event: "badge", data: { appId: "sa_1", chatId: "sc_1", text: "Pick one", priority: "needs_you" } } });
    expect(s.badges.map((b) => [b.chatId, b.text])).toEqual([
      ["sc_1", "Pick one"],
      ["sc_9", "Which color?"],
    ]);
  });

  it("opens hands-free on show hands_free", () => {
    const s = voiceReducer(live(), { type: "stream", event: { event: "client", data: { show: "hands_free" } } });
    expect(s.handsFree).toBe(true);
  });

  it("opens hands-free on the first focus move to another App only", () => {
    let s = voiceReducer(live(), { type: "stream", event: { event: "client", data: { focus: { app: "sa_1", chat: "sc_2" } } } });
    expect(s).toMatchObject({ handsFree: false, focus: { app: "sa_1", chat: "sc_2" } });
    s = voiceReducer(s, { type: "stream", event: { event: "client", data: { focus: { app: "sa_2" } } } });
    expect(s).toMatchObject({ handsFree: true, focus: { app: "sa_2" } });
    s = voiceReducer(s, { type: "hands_free", open: false });
    s = voiceReducer(s, { type: "stream", event: { event: "client", data: { focus: { app: "sa_3" } } } });
    expect(s.handsFree).toBe(false);
  });

  it("mutes, sets quiet and moves focus by hand", () => {
    let s = voiceReducer(live(), { type: "mute", muted: true });
    s = voiceReducer(s, { type: "quiet", quiet: true });
    s = voiceReducer(s, { type: "focus", focus: { app: "sa_1", chat: "sc_3" } });
    expect(s).toMatchObject({ muted: true, quiet: true, focus: { app: "sa_1", chat: "sc_3" } });
  });
});

describe("routeClientAction", () => {
  const here = { app: "sa_1", chat: "sc_1" };
  it("opens another App at its URL, with the chat when given", () => {
    expect(routeClientAction({ focus: { app: "sa_2" } }, here)).toEqual({ kind: "navigate", href: "/studio/sa_2" });
    expect(routeClientAction({ focus: { app: "sa_2", chat: "sc_7" } }, here)).toEqual({ kind: "navigate", href: "/studio/sa_2?chat=sc_7" });
  });
  it("switches chats within the same App without navigating", () => {
    expect(routeClientAction({ focus: { app: "sa_1", chat: "sc_2" } }, here)).toEqual({ kind: "chat", chat: "sc_2" });
    expect(routeClientAction({ focus: { app: "sa_1" } }, here)).toEqual({ kind: "none" });
  });
  it("maps show to the workspace view or the hands-free view", () => {
    expect(routeClientAction({ show: "preview" }, here)).toEqual({ kind: "view", view: "preview" });
    expect(routeClientAction({ show: "code" }, here)).toEqual({ kind: "view", view: "code" });
    expect(routeClientAction({ show: "history" }, here)).toEqual({ kind: "view", view: "history" });
    expect(routeClientAction({ show: "hands_free" }, here)).toEqual({ kind: "hands_free" });
  });
  it("escapes ids in the URL", () => {
    expect(routeClientAction({ focus: { app: "a/b", chat: "c&d" } }, here)).toEqual({ kind: "navigate", href: "/studio/a%2Fb?chat=c%26d" });
  });
});

describe("focusChanged", () => {
  it("compares app and chat", () => {
    expect(focusChanged({ app: "a", chat: "c" }, { app: "a", chat: "c" })).toBe(false);
    expect(focusChanged({ app: "a", chat: "c" }, { app: "a" })).toBe(true);
    expect(focusChanged({ app: "a" }, { app: "b" })).toBe(true);
  });
});

describe("startError", () => {
  it("reads the API's message and code", () => {
    expect(startError(409, { error: "Add an OpenAI key to talk to Studio", code: "no_openai_key" })).toMatchObject({
      message: "Add an OpenAI key to talk to Studio",
      code: "no_openai_key",
    });
  });
  it("falls back to the status when the body isn't the API's error", () => {
    expect(startError(502, null)).toMatchObject({ message: "Voice didn't start (HTTP 502)", code: undefined });
  });
});
