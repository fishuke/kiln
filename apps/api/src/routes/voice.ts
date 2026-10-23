import type { Scope } from "@kiln/auth";
import { MODEL_KEYS, type Kiln } from "@kiln/engine";
import { runTool, StudioError, type TeamRole, type ToolCaller } from "@kiln/studio";
import {
  Conductor,
  narrate,
  resumeSeed,
  VOICE_LIMITS,
  VoiceError,
  voiceInstructions,
  VoiceSessionStore,
  type Focus,
  type Thinker,
  type VoiceEvent,
  type VoiceLink,
  type VoiceProvider,
  type VoiceSession,
  type VoiceStreamEvent,
} from "@kiln/voice";
import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { HttpError, type Env, type RouteContext } from "../app";
import type { Route } from "../openapi";
import { reportError } from "../trace-context";
import { shipperFor, studioEnabled, studioFor } from "./studio";

const Focus = z.object({ app: z.string().min(1).optional(), chat: z.string().min(1).optional() }).strict();
export const CreateVoiceSession = z
  .object({
    /** The browser's WebRTC offer. */
    sdp: z.string().min(1),
    app: z.string().min(1).optional(),
    chat: z.string().min(1).optional(),
    /** A stored session to carry on (same team and person): a new live session seeded with its transcript and focus. */
    resume: z.string().min(1).optional(),
  })
  .strict();
export const UpdateVoiceSession = z.object({ focus: Focus.optional(), quiet: z.boolean().optional() }).strict();

const V = "Voice";
export const routes: Route[] = [
  {
    method: "post",
    path: "/api/v1/voice/sessions",
    summary: "Start a voice session (GPT-Live) from the browser's WebRTC offer, or resume one; 409 no_openai_key without an OpenAI key",
    scope: "send",
    body: CreateVoiceSession,
    tag: V,
  },
  {
    method: "get",
    path: "/api/v1/voice/sessions/{id}/events",
    summary: "Server-sent events of a voice session: client actions, transcript lines, badges and state",
    scope: "read",
    tag: V,
  },
  {
    method: "patch",
    path: "/api/v1/voice/sessions/{id}",
    summary: "Tell a voice session where the person is now, or turn quiet mode on or off",
    scope: "send",
    body: UpdateVoiceSession,
    tag: V,
  },
  { method: "delete", path: "/api/v1/voice/sessions/{id}", summary: "End a voice session", scope: "send", tag: V },
];

export type VoiceOptions = {
  provider: VoiceProvider;
  /** The decision model behind the conductor, given the team's Anthropic model key if it has one; undefined when none is configured. */
  thinker: (anthropicKey: string | undefined) => Thinker | undefined;
};

/** How often the idle and length limits are checked; the limits themselves are measured on the injected Clock. */
const TICK_MS = 5_000;
/** How long a closed session's sideband stays open for the provider's usage report. */
const CLOSE_GRACE_MS = 30_000;

/** A session with a live sideband in this process. */
type Live = {
  id: string;
  link: VoiceLink;
  off: () => void;
  thinker: Thinker;
  caller: ToolCaller;
  startedAt: number;
  lastInputAt: number;
  /** The line being spoken now, by whom; written to the transcript when the other side speaks or a delegation arrives. */
  line?: { role: "person" | "voice"; text: string };
  /** The person's words since the last delegation. */
  words: string;
  /** Delegations run one at a time, in order. */
  queue: Promise<void>;
  closingSince?: number;
};

class VoiceUnavailable extends Error {}

/**
 * Talk to Studio (ADR-013): the live sessions of one Kiln. Holds each session's sideband in memory, runs
 * the conductor on its delegations and the narrator on its team's Studio events, and streams what the
 * browser needs. Session state (transcript, focus, pending confirmation, usage) is in the Store.
 */
export class VoiceHub {
  private readonly sessions: VoiceSessionStore;
  private readonly live = new Map<string, Live>();
  private readonly listeners = new Map<string, Set<(e: VoiceStreamEvent) => void>>();
  private readonly offBus: () => void;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly kiln: Kiln,
    private readonly options: VoiceOptions,
  ) {
    this.sessions = new VoiceSessionStore(kiln.store, kiln.clock);
    this.offBus = kiln.bus.subscribe("*", (e) => {
      if (e.type.startsWith("studio.")) this.narrate(e.type, e.payload);
    });
  }

  get(id: string): VoiceSession | undefined {
    return this.sessions.get(id);
  }

  async create(input: { team: string; by: string; role?: TeamRole; sdp: string; focus: Focus; resume?: VoiceSession }): Promise<{ id: string; sdp: string }> {
    const apiKey = this.secret(input.team, MODEL_KEYS.openai.name) ?? this.kiln.secrets.getSecret("OPENAI_API_KEY");
    if (!apiKey) throw new VoiceError("no_openai_key", "Voice needs an OpenAI key: add one in your team's model keys, or set OPENAI_API_KEY on the server");
    const thinker = this.options.thinker(this.secret(input.team, MODEL_KEYS.anthropic.name));
    if (!thinker) throw new VoiceUnavailable("Voice needs a decision model: set LLM_GATEWAY_URL or ANTHROPIC_API_KEY, or add your team's Anthropic key");
    const focus = input.focus.app ? input.focus : (input.resume?.focus ?? {});
    const created = await this.options.provider.create({ apiKey, sdp: input.sdp, instructions: voiceInstructions(focus) });

    if (input.resume) this.drop(input.resume.id);
    const session = input.resume
      ? this.sessions.update(input.resume.id, { liveSessionId: created.sessionId, status: "connecting", focus })
      : this.sessions.create({ team: input.team, by: input.by, focus, liveSessionId: created.sessionId });
    let link: VoiceLink;
    try {
      link = await this.options.provider.attach(created.sessionId, apiKey);
    } catch (err) {
      this.sessions.update(session.id, { status: "closed" });
      throw err;
    }
    const now = this.now();
    const live: Live = {
      id: session.id,
      link,
      off: () => undefined,
      thinker,
      caller: { team: input.team, by: input.by, via: "voice", ...(input.role ? { role: input.role } : {}) },
      startedAt: now,
      lastInputAt: now,
      words: "",
      queue: Promise.resolve(),
    };
    live.off = link.on((e) => this.onEvent(live, e));
    this.live.set(session.id, live);
    this.startTimer();
    const seed = input.resume ? resumeSeed(session) : undefined;
    if (seed) link.send(seed);
    this.emitState(session);
    return { id: session.id, sdp: created.sdp };
  }

  /** The person moved by hand or toggled quiet mode; either wakes an idle session. */
  update(id: string, patch: z.infer<typeof UpdateVoiceSession>): VoiceSession {
    const live = this.live.get(id);
    const before = this.sessions.get(id)!;
    const wake = before.status === "idle" && live;
    if (wake) {
      live.link.send({ type: "unmute" });
      live.lastInputAt = this.now();
    }
    const session = this.sessions.update(id, {
      ...(patch.focus ? { focus: patch.focus } : {}),
      ...(patch.quiet !== undefined ? { quiet: patch.quiet } : {}),
      ...(wake ? { status: "live" as const } : {}),
    });
    this.emitState(session);
    return session;
  }

  /** Asks the live session to close and marks it closed; the sideband stays open for the usage report. */
  close(id: string): VoiceSession {
    const live = this.live.get(id);
    if (live && live.closingSince === undefined) {
      live.closingSince = this.now();
      this.send(live, { type: "close" });
    }
    const session = this.sessions.update(id, { status: "closed" });
    this.emitState(session);
    return session;
  }

  /** The browser's stream of a session. */
  listen(id: string, listener: (e: VoiceStreamEvent) => void): () => void {
    const set = this.listeners.get(id) ?? new Set();
    set.add(listener);
    this.listeners.set(id, set);
    return () => {
      set.delete(listener);
      if (!set.size) this.listeners.delete(id);
    };
  }

  /** Idle sessions stop listening; sessions end at the length limit (VOICE_LIMITS). */
  tick() {
    const now = this.now();
    for (const live of [...this.live.values()]) {
      if (live.closingSince !== undefined) {
        if (now - live.closingSince >= CLOSE_GRACE_MS) this.drop(live.id);
        continue;
      }
      if (now - live.startedAt >= VOICE_LIMITS.maxSeconds * 1000) {
        this.close(live.id);
        continue;
      }
      if (this.sessions.get(live.id)?.status === "live" && now - live.lastInputAt >= VOICE_LIMITS.idleSeconds * 1000) {
        this.send(live, { type: "mute" });
        this.emitState(this.sessions.update(live.id, { status: "idle" }));
      }
    }
  }

  shutdown() {
    for (const id of [...this.live.keys()]) this.drop(id);
    this.offBus();
    this.stopTimer();
  }

  private onEvent(live: Live, e: VoiceEvent) {
    switch (e.type) {
      case "started":
        this.emitState(this.sessions.update(live.id, { status: "live" }));
        break;
      case "input_transcript": {
        live.lastInputAt = this.now();
        live.words += e.text;
        this.hear(live, "person", e.text);
        break;
      }
      case "output_transcript":
        this.hear(live, "voice", e.text);
        break;
      case "delegation": {
        this.flush(live);
        const words = live.words.trim();
        live.words = "";
        live.queue = live.queue.then(() => this.delegate(live, e.id, words));
        break;
      }
      case "closed": {
        this.flush(live);
        const s = this.sessions.get(live.id)!;
        const session = this.sessions.update(live.id, {
          status: "closed",
          seconds: s.seconds + (e.usage?.seconds ?? 0),
          costUsd: s.costUsd + (e.usage?.costUsd ?? 0),
        });
        this.drop(live.id);
        this.emitState(session);
        break;
      }
      case "error":
        reportError(new Error(`voice session ${live.id}: ${e.message}`), 502, { "kiln.voice.session": live.id });
        break;
    }
  }

  /** Transcripts arrive in pieces; a line is written once the other side speaks or a delegation arrives. */
  private hear(live: Live, role: "person" | "voice", text: string) {
    if (live.line && live.line.role !== role) this.flush(live);
    live.line = { role, text: (live.line?.text ?? "") + text };
    if (role === "person") this.wake(live);
  }

  private flush(live: Live) {
    const line = live.line;
    live.line = undefined;
    const text = line?.text.trim();
    if (!line || !text) return;
    this.sessions.appendTranscript(live.id, { role: line.role, text });
    this.emit(live.id, { event: "transcript", data: { role: line.role, text } });
  }

  private wake(live: Live) {
    if (this.sessions.get(live.id)?.status !== "idle") return;
    this.send(live, { type: "unmute" });
    this.emitState(this.sessions.update(live.id, { status: "live" }));
  }

  /** One delegation: the conductor decides, Studio acts, and the voice gets an answer to say or keep. */
  private async delegate(live: Live, delegation: string, words: string) {
    const session = this.sessions.get(live.id);
    if (!session || this.live.get(live.id) !== live) return;
    const studio = studioFor(this.kiln);
    try {
      if (!studio) throw new Error("Studio isn't available on this server");
      const conductor = new Conductor({
        thinker: live.thinker,
        runTool: (name, input) => runTool(studio, name, input, live.caller, shipperFor(this.kiln)),
        clock: this.kiln.clock,
      });
      const result = await conductor.handle(
        { focus: session.focus, transcript: session.transcript, ...(session.pending ? { pending: session.pending } : {}) },
        words,
      );
      const updated = this.sessions.update(live.id, { focus: result.focus, pending: result.pending });
      for (const action of result.client) this.emit(live.id, { event: "client", data: action });
      if (result.client.length) this.emitState(updated);
      if (result.say) this.send(live, { type: "say", text: result.say, delegation });
      if (result.think) this.send(live, { type: "think", text: result.think, delegation });
      // Every delegation gets an answer, so the voice isn't left waiting.
      if (!result.say && !result.think) this.send(live, { type: "think", text: "Done.", delegation });
    } catch (err) {
      reportError(err, 500, { "kiln.voice.session": live.id });
      this.send(live, { type: "say", text: `I couldn't do that: ${err instanceof Error ? err.message : String(err)}`, delegation });
    }
  }

  /** A Studio event for the sessions of the App's team. */
  private narrate(type: string, payload: unknown) {
    const appId = (payload as { appId?: unknown } | null)?.appId;
    if (typeof appId !== "string" || !this.live.size) return;
    const team = studioFor(this.kiln)?.getApp(appId)?.app.team;
    if (!team) return;
    for (const live of this.live.values()) {
      if (live.caller.team !== team || live.closingSince !== undefined) continue;
      const session = this.sessions.get(live.id);
      if (!session) continue;
      const { command, badge } = narrate({ type, payload }, { focus: session.focus, quiet: session.quiet, idle: session.status === "idle" });
      if (command) this.send(live, command);
      if (badge) this.emit(live.id, { event: "badge", data: badge });
    }
  }

  private send(live: Live, command: Parameters<VoiceLink["send"]>[0]) {
    try {
      live.link.send(command);
    } catch (err) {
      reportError(err, 502, { "kiln.voice.session": live.id });
    }
  }

  private drop(id: string) {
    const live = this.live.get(id);
    if (!live) return;
    this.live.delete(id);
    live.off();
    live.link.detach();
    if (!this.live.size) this.stopTimer();
  }

  private emitState(session: VoiceSession) {
    this.emit(session.id, { event: "state", data: { status: session.status, focus: session.focus, quiet: session.quiet } });
  }

  private emit(id: string, event: VoiceStreamEvent) {
    for (const l of this.listeners.get(id) ?? []) l(event);
  }

  private secret(team: string, name: string): string | undefined {
    return this.kiln.vault.resolver({ teamId: team }).get(name) || undefined;
  }

  private now() {
    return this.kiln.clock.now().getTime();
  }

  private startTimer() {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.timer.unref?.();
  }

  private stopTimer() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}

const configured = new WeakMap<Kiln, VoiceOptions>();
const hubs = new WeakMap<Kiln, VoiceHub>();

/** The voice provider and decision model for a `Kiln`: the real ones in config.ts, fakes in tests. */
export function configureVoice(kiln: Kiln, options: VoiceOptions) {
  hubs.get(kiln)?.shutdown();
  hubs.delete(kiln);
  configured.set(kiln, options);
}

/** The voice sessions of a `Kiln`; undefined until configureVoice gave it a provider. */
export function voiceFor(kiln: Kiln): VoiceHub | undefined {
  const existing = hubs.get(kiln);
  if (existing) return existing;
  const options = configured.get(kiln);
  if (!options) return undefined;
  const hub = new VoiceHub(kiln, options);
  hubs.set(kiln, hub);
  return hub;
}

const STATUS: Record<VoiceError["code"], 404 | 409 | 502> = { no_openai_key: 409, provider_failed: 502, not_found: 404, closed: 409 };

/** Voice routes (docs/specs/107.md). A session belongs to the person who started it, in their current team. */
export function register(ctx: RouteContext) {
  const { app, kiln } = ctx;
  const hub = () => {
    if (!studioFor(kiln))
      throw new VoiceUnavailable(studioEnabled() ? "Studio needs a sandbox backend (KILN_SANDBOX)" : "Studio is not enabled on this server (KILN_STUDIO=1)");
    const h = voiceFor(kiln);
    if (!h) throw new VoiceUnavailable("voice isn't configured on this server");
    return h;
  };
  const caller = (c: Context<Env>, scope: Scope) => {
    ctx.need(c, scope, "*");
    const access = ctx.access(c);
    const role: TeamRole | undefined = access.superuser ? "owner" : access.teamRole;
    return { team: ctx.team(c).id, by: ctx.user(c).email, ...(role ? { role } : {}) };
  };
  const own = (c: Context<Env>, id: string, scope: Scope) => {
    const who = caller(c, scope);
    const session = hub().get(id);
    if (!session || session.team !== who.team || session.by !== who.by) throw new HttpError(404, `unknown voice session ${id}`);
    return session;
  };
  type Handler = (c: Context<Env>) => Promise<Response> | Response;
  const wrap =
    (fn: Handler): Handler =>
    async (c) => {
      try {
        return await fn(c);
      } catch (err) {
        const [status, code] =
          err instanceof VoiceError
            ? [STATUS[err.code], err.code]
            : err instanceof VoiceUnavailable || (err instanceof StudioError && err.code === "unavailable")
              ? [503 as const, "unavailable"]
              : [undefined, undefined];
        if (!status) throw err;
        reportError(err, status, { "kiln.voice.error.code": code, "http.route": c.req.routePath });
        return c.json({ error: (err as Error).message, code }, status);
      }
    };
  const id = (c: Context<Env>) => c.req.param("id")!;

  app.post(
    "/api/v1/voice/sessions",
    wrap(async (c) => {
      const who = caller(c, "send");
      const { sdp, app: appId, chat, resume } = CreateVoiceSession.parse(await c.req.json());
      const previous = resume ? own(c, resume, "send") : undefined;
      const focus: Focus = { ...(appId ? { app: appId } : {}), ...(chat ? { chat } : {}) };
      return c.json(await hub().create({ ...who, sdp, focus, ...(previous ? { resume: previous } : {}) }), 201);
    }),
  );
  app.get(
    "/api/v1/voice/sessions/:id/events",
    wrap((c) => {
      const session = own(c, id(c), "read");
      const h = hub();
      return streamSSE(c, async (stream) => {
        let queue = stream.writeSSE({ event: "state", data: JSON.stringify({ status: session.status, focus: session.focus, quiet: session.quiet }) });
        const off = h.listen(session.id, (e) => {
          queue = queue.then(() => (stream.aborted ? undefined : stream.writeSSE({ event: e.event, data: JSON.stringify(e.data) })));
        });
        await new Promise<void>((resolve) => stream.onAbort(resolve));
        off();
        await queue;
      });
    }),
  );
  app.patch(
    "/api/v1/voice/sessions/:id",
    wrap(async (c) => {
      const session = own(c, id(c), "send");
      return c.json(hub().update(session.id, UpdateVoiceSession.parse(await c.req.json())));
    }),
  );
  app.delete(
    "/api/v1/voice/sessions/:id",
    wrap((c) => {
      const session = own(c, id(c), "send");
      return c.json(hub().close(session.id));
    }),
  );
}
