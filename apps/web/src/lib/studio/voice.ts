"use client";

/**
 * Talk to Studio (ADR-013, docs/specs/107.md): the browser half of a voice session. The mic and the
 * voice travel over WebRTC straight to GPT-Live; Kiln's API creates the session from our offer and
 * streams what the session does (client actions, transcript, badges, state) back over SSE.
 *
 * The session lives in a module-level controller, not in a component, so it survives the page
 * changing under it when the voice moves the person to another App.
 */
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { z } from "zod";

// ---- Wire shapes (re-declared like ./types, so the web doesn't depend on packages/voice) ----

export type Focus = { app?: string; chat?: string };
/** What a Studio client tool asks the screen to do (`focus`, `show`). */
export type ClientAction = { focus: { app: string; chat?: string } } | { show: "preview" | "code" | "history" | "hands_free" };
export type Badge = { appId: string; chatId?: string; text: string; priority: "needs_you" | "finished" };
export type TranscriptLine = { role: "person" | "voice"; text: string };
export type SessionStatus = "connecting" | "live" | "idle" | "closed";

const FocusWire = z.object({ app: z.string().optional(), chat: z.string().optional() });
const ClientActionWire = z.union([
  z.object({ focus: z.object({ app: z.string(), chat: z.string().optional() }) }),
  z.object({ show: z.enum(["preview", "code", "history", "hands_free"]) }),
]);
const BadgeWire = z.object({ appId: z.string(), chatId: z.string().optional(), text: z.string(), priority: z.enum(["needs_you", "finished"]) });
const TranscriptWire = z.object({ role: z.enum(["person", "voice"]), text: z.string() });
const StateWire = z.object({ status: z.enum(["connecting", "live", "idle", "closed"]), focus: FocusWire, quiet: z.boolean() });
const Created = z.object({ id: z.string().min(1), sdp: z.string().min(1) });
const ApiError = z.object({ error: z.string(), code: z.string().optional() });

/** Events on GET /api/v1/voice/sessions/{id}/events. */
export type VoiceStreamEvent =
  | { event: "client"; data: ClientAction }
  | { event: "transcript"; data: TranscriptLine }
  | { event: "badge"; data: Badge }
  | { event: "state"; data: { status: SessionStatus; focus: Focus; quiet: boolean } };

// ---- State machine ----

export type VoicePhase = "idle" | "connecting" | "live" | "ending" | "error";

export type VoiceState = {
  phase: VoicePhase;
  sessionId?: string;
  /** The server's view: `idle` once it stopped listening after a quiet spell. */
  status?: SessionStatus;
  focus: Focus;
  quiet: boolean;
  /** The mic track is off (local; the voice keeps talking). */
  muted: boolean;
  transcript: TranscriptLine[];
  /** One per chat, newest first: the needs-you list. */
  badges: Badge[];
  handsFree: boolean;
  /** Hands-free already opened by itself once (on the first move to another App). */
  autoOpened: boolean;
  error?: { message: string; code?: string };
};

export const INITIAL_VOICE: VoiceState = {
  phase: "idle",
  focus: {},
  quiet: false,
  muted: false,
  transcript: [],
  badges: [],
  handsFree: false,
  autoOpened: false,
};

/** The web keeps as many transcript lines as the session does (VOICE_LIMITS.transcriptLines). */
const TRANSCRIPT_LINES = 40;
const BADGES = 20;

export type VoiceAction =
  | { type: "start"; focus: Focus }
  | { type: "connected"; id: string }
  /** `session.started` on the data channel. */
  | { type: "started" }
  | { type: "stream"; event: VoiceStreamEvent }
  | { type: "mute"; muted: boolean }
  | { type: "quiet"; quiet: boolean }
  /** The person moved by hand. */
  | { type: "focus"; focus: Focus }
  | { type: "hands_free"; open: boolean }
  | { type: "ending" }
  | { type: "ended" }
  | { type: "failed"; message: string; code?: string };

export function voiceReducer(s: VoiceState, a: VoiceAction): VoiceState {
  switch (a.type) {
    case "start":
      return { ...INITIAL_VOICE, phase: "connecting", focus: a.focus };
    case "connected":
      return { ...s, sessionId: a.id };
    case "started":
      return s.phase === "connecting" ? { ...s, phase: "live" } : s;
    case "mute":
      return { ...s, muted: a.muted };
    case "quiet":
      return { ...s, quiet: a.quiet };
    case "focus":
      return { ...s, focus: a.focus };
    case "hands_free":
      return { ...s, handsFree: a.open };
    case "ending":
      return { ...s, phase: "ending" };
    case "ended":
      return INITIAL_VOICE;
    case "failed":
      return { ...INITIAL_VOICE, phase: "error", error: { message: a.message, code: a.code } };
    case "stream":
      return onStream(s, a.event);
  }
}

function onStream(s: VoiceState, e: VoiceStreamEvent): VoiceState {
  switch (e.event) {
    case "state": {
      if (e.data.status === "closed") return INITIAL_VOICE;
      const phase = s.phase === "connecting" && e.data.status !== "connecting" ? "live" : s.phase;
      return { ...s, phase, status: e.data.status, focus: e.data.focus, quiet: e.data.quiet };
    }
    case "transcript":
      return { ...s, transcript: [...s.transcript, e.data].slice(-TRANSCRIPT_LINES) };
    case "badge": {
      const same = (b: Badge) => b.appId === e.data.appId && b.chatId === e.data.chatId;
      return { ...s, badges: [e.data, ...s.badges.filter((b) => !same(b))].slice(0, BADGES) };
    }
    case "client": {
      const c = e.data;
      if ("show" in c) return c.show === "hands_free" ? { ...s, handsFree: true } : s;
      const otherApp = Boolean(s.focus.app && c.focus.app !== s.focus.app);
      const open = otherApp && !s.autoOpened;
      return { ...s, focus: c.focus, handsFree: s.handsFree || open, autoOpened: s.autoOpened || open };
    }
  }
}

export function focusChanged(a: Focus, b: Focus): boolean {
  return a.app !== b.app || a.chat !== b.chat;
}

/** What a client action does to the screen, given where the person is. */
export type ScreenMove =
  | { kind: "navigate"; href: string }
  | { kind: "chat"; chat: string }
  | { kind: "view"; view: "preview" | "code" | "history" }
  | { kind: "hands_free" }
  | { kind: "none" };

export function routeClientAction(action: ClientAction, here: Focus): ScreenMove {
  if ("show" in action) return action.show === "hands_free" ? { kind: "hands_free" } : { kind: "view", view: action.show };
  const { app, chat } = action.focus;
  if (app !== here.app) return { kind: "navigate", href: `/studio/${encodeURIComponent(app)}${chat ? `?chat=${encodeURIComponent(chat)}` : ""}` };
  return chat && chat !== here.chat ? { kind: "chat", chat } : { kind: "none" };
}

/** A failed start: the API's message and code (`no_openai_key`), or the HTTP status. */
export class VoiceStartError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = "VoiceStartError";
  }
}

export function startError(status: number, body: unknown): VoiceStartError {
  const parsed = ApiError.safeParse(body);
  return parsed.success ? new VoiceStartError(parsed.data.error, parsed.data.code) : new VoiceStartError(`Voice didn't start (HTTP ${status})`);
}

// ---- The live session (browser only) ----

const STORAGE_KEY = "kiln.voice.session";
const ICE_TIMEOUT_MS = 10_000;
const CLOSE_TIMEOUT_MS = 15_000;
const BASE = "/api/v1/voice/sessions";

function stored(): string | undefined {
  try {
    return sessionStorage.getItem(STORAGE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}
function store(id: string | undefined) {
  try {
    if (id) sessionStorage.setItem(STORAGE_KEY, id);
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Private mode: the session just won't resume after a reload.
  }
}

/** Resolves when ICE gathering completes, or after `ms` with what was gathered so far. */
function iceGathered(pc: RTCPeerConnection, ms: number): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      pc.removeEventListener("icegatheringstatechange", check);
      resolve();
    };
    const check = () => pc.iceGatheringState === "complete" && done();
    const timer = setTimeout(done, ms);
    pc.addEventListener("icegatheringstatechange", check);
  });
}

function micError(err: unknown): VoiceStartError {
  const name = err instanceof DOMException ? err.name : "";
  if (name === "NotAllowedError" || name === "SecurityError")
    return new VoiceStartError("Microphone access is blocked. Allow it in the browser to talk.", "mic_blocked");
  if (name === "NotFoundError") return new VoiceStartError("No microphone found.", "no_mic");
  return new VoiceStartError(err instanceof Error ? err.message : String(err));
}

type Live = {
  id?: string;
  pc: RTCPeerConnection;
  channel: RTCDataChannel;
  mic: MediaStream;
  audio: HTMLAudioElement;
  events?: EventSource;
  closed: Promise<void>;
};

class VoiceController {
  private state: VoiceState = INITIAL_VOICE;
  private readonly listeners = new Set<() => void>();
  private readonly clients = new Set<(a: ClientAction) => void>();
  private live?: Live;
  /** Bumped by every start and end, so a start that was cancelled stops at its next step. */
  private attempt = 0;
  resumeTried = false;

  get = () => this.state;
  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => void this.listeners.delete(l);
  };
  /** Client actions for the mounted workspace; the reducer has already applied them to the state. */
  onClient(l: (a: ClientAction) => void) {
    this.clients.add(l);
    return () => void this.clients.delete(l);
  }
  get storedSession() {
    return stored();
  }

  private dispatch(a: VoiceAction) {
    this.state = voiceReducer(this.state, a);
    for (const l of this.listeners) l();
  }

  async start(focus: Focus, resume?: string) {
    if (this.state.phase === "connecting" || this.state.phase === "live" || this.state.phase === "ending") return;
    this.dispatch({ type: "start", focus });
    const n = ++this.attempt;
    const cancelled = () => n !== this.attempt;
    let mic: MediaStream | undefined;
    let pc: RTCPeerConnection | undefined;
    try {
      mic = await navigator.mediaDevices.getUserMedia({ audio: true }).catch((err: unknown) => {
        throw micError(err);
      });
      if (cancelled()) return mic.getTracks().forEach((t) => t.stop());
      pc = new RTCPeerConnection();
      const audio = new Audio();
      audio.autoplay = true;
      pc.ontrack = (e) => {
        audio.srcObject = e.streams[0] ?? null;
      };
      for (const t of mic.getAudioTracks()) pc.addTrack(t, mic);
      // GPT-Live's events channel must exist before the offer.
      const channel = pc.createDataChannel("oai-events");
      let markClosed: () => void = () => undefined;
      const closed = new Promise<void>((r) => (markClosed = r));
      channel.onmessage = (m) => {
        const type = (() => {
          try {
            return z.object({ type: z.string() }).parse(JSON.parse(String(m.data))).type;
          } catch {
            return undefined;
          }
        })();
        if (type === "session.started") this.dispatch({ type: "started" });
        if (type === "session.closed") markClosed();
      };
      pc.onconnectionstatechange = () => {
        if (pc?.connectionState === "failed" && this.live?.pc === pc) this.fail(new VoiceStartError("The voice connection dropped."));
      };
      this.live = { pc, channel, mic, audio, closed };

      await pc.setLocalDescription(await pc.createOffer());
      await iceGathered(pc, ICE_TIMEOUT_MS);
      const res = await fetch(BASE, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sdp: pc.localDescription?.sdp, ...focus, ...(resume ? { resume } : {}) }),
      });
      const body: unknown = await res.json().catch(() => null);
      if (!res.ok) throw startError(res.status, body);
      const created = Created.safeParse(body);
      if (!created.success) throw new VoiceStartError("Voice didn't start: unexpected response");
      if (cancelled()) {
        // Ended while connecting: close the session the API just created.
        await fetch(`${BASE}/${encodeURIComponent(created.data.id)}`, { method: "DELETE" }).catch(() => undefined);
        return;
      }
      await pc.setRemoteDescription({ type: "answer", sdp: created.data.sdp });
      if (!this.live) return;
      this.live.id = created.data.id;
      store(created.data.id);
      this.dispatch({ type: "connected", id: created.data.id });
      this.listen(created.data.id);
    } catch (err) {
      if (resume) store(undefined);
      if (!cancelled()) this.fail(err instanceof VoiceStartError ? err : new VoiceStartError(err instanceof Error ? err.message : String(err)));
      else if (!this.live) mic?.getTracks().forEach((t) => t.stop());
    }
  }

  private listen(id: string) {
    const live = this.live;
    if (!live || typeof EventSource === "undefined") return;
    const events = new EventSource(`${BASE}/${encodeURIComponent(id)}/events`);
    live.events = events;
    const on = <T>(name: VoiceStreamEvent["event"], schema: z.ZodType<T>, then?: (data: T) => void) =>
      events.addEventListener(name, (m) => {
        let data: T;
        try {
          data = schema.parse(JSON.parse((m as MessageEvent<string>).data));
        } catch {
          return;
        }
        this.dispatch({ type: "stream", event: { event: name, data } as VoiceStreamEvent });
        then?.(data);
      });
    on("client", ClientActionWire, (a) => this.clients.forEach((l) => l(a)));
    on("transcript", TranscriptWire);
    on("badge", BadgeWire);
    on("state", StateWire, (s) => s.status === "closed" && this.teardown());
  }

  /** Ends the session: `session.close` on the data channel, wait for `session.closed` (15 s at most), then DELETE. */
  async end() {
    const phase = this.state.phase;
    if (phase !== "connecting" && phase !== "live") return;
    this.attempt++;
    const live = this.live;
    this.dispatch({ type: "ending" });
    if (live?.channel.readyState === "open") {
      live.channel.send(JSON.stringify({ type: "session.close" }));
      await Promise.race([live.closed, new Promise((r) => setTimeout(r, CLOSE_TIMEOUT_MS))]);
    }
    if (live?.id) await fetch(`${BASE}/${encodeURIComponent(live.id)}`, { method: "DELETE" }).catch(() => undefined);
    this.teardown();
    this.dispatch({ type: "ended" });
  }

  setMuted(muted: boolean) {
    this.live?.mic.getAudioTracks().forEach((t) => (t.enabled = !muted));
    this.dispatch({ type: "mute", muted });
  }

  setQuiet(quiet: boolean) {
    this.dispatch({ type: "quiet", quiet });
    void this.patch({ quiet });
  }

  /** An idle session stopped listening; only this (or moving by hand) starts it again, since it hears nothing while paused. */
  wake() {
    void this.patch({ wake: true });
  }

  /** The person moved by hand: tell the session where they are now. */
  setFocus(focus: Focus) {
    if (!this.live?.id || !focusChanged(this.state.focus, focus)) return;
    this.dispatch({ type: "focus", focus });
    void this.patch({ focus });
  }

  setHandsFree(open: boolean) {
    this.dispatch({ type: "hands_free", open });
  }

  dismissError() {
    if (this.state.phase === "error") this.dispatch({ type: "ended" });
  }

  private async patch(body: { focus?: Focus; quiet?: boolean; wake?: true }) {
    const id = this.live?.id;
    if (!id) return;
    await fetch(`${BASE}/${encodeURIComponent(id)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(
      () => undefined,
    );
  }

  private fail(err: VoiceStartError) {
    this.teardown();
    this.dispatch({ type: "failed", message: err.message, code: err.code });
  }

  private teardown() {
    const live = this.live;
    this.live = undefined;
    store(undefined);
    if (!live) return;
    live.events?.close();
    live.channel.close();
    live.pc.close();
    live.mic.getTracks().forEach((t) => t.stop());
    live.audio.srcObject = null;
    if (this.state.phase !== "ending" && this.state.phase !== "error") this.dispatch({ type: "ended" });
  }
}

let controller: VoiceController | undefined;
const shared = () => (controller ??= new VoiceController());
const serverState = () => INITIAL_VOICE;

export type VoiceHandlers = {
  /** Switch to a chat in the App on screen. */
  onChat: (chat: string) => void;
  /** Show the preview, the code or the history. */
  onView: (view: "preview" | "code" | "history") => void;
};

/**
 * The voice session for the Studio workspace showing `focus`. Starts on `start()` (the Talk click),
 * resumes after a reload, applies the session's client actions to the screen and tells the session
 * when the person moves by hand. Call it once per page.
 */
export function useVoice(focus: Focus, handlers: VoiceHandlers) {
  const router = useRouter();
  const c = shared();
  const state = useSyncExternalStore(c.subscribe, c.get, serverState);
  const here = useRef(focus);
  here.current = focus;
  const latest = useRef(handlers);
  latest.current = handlers;

  useEffect(
    () =>
      c.onClient((action) => {
        const move = routeClientAction(action, here.current);
        if (move.kind === "navigate") router.push(move.href);
        else if (move.kind === "chat") latest.current.onChat(move.chat);
        else if (move.kind === "view") latest.current.onView(move.view);
      }),
    [c, router],
  );

  // A reload drops the connection; the stored session resumes with its transcript and focus.
  useEffect(() => {
    if (c.resumeTried) return;
    c.resumeTried = true;
    const id = c.storedSession;
    if (id && c.get().phase === "idle") void c.start(here.current, id);
  }, [c]);

  useEffect(() => {
    if (state.phase === "live") c.setFocus({ app: focus.app, chat: focus.chat });
  }, [c, state.phase, focus.app, focus.chat]);

  return {
    state,
    start: useCallback(() => void c.start(here.current), [c]),
    end: useCallback(() => void c.end(), [c]),
    setMuted: useCallback((m: boolean) => c.setMuted(m), [c]),
    setQuiet: useCallback((q: boolean) => c.setQuiet(q), [c]),
    wake: useCallback(() => c.wake(), [c]),
    setHandsFree: useCallback((o: boolean) => c.setHandsFree(o), [c]),
    dismissError: useCallback(() => c.dismissError(), [c]),
  };
}

export type Voice = ReturnType<typeof useVoice>;
