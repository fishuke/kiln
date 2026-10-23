/**
 * OpenAI GPT-Live as the voice provider (ADR-013). `create` exchanges the browser's WebRTC offer
 * for an answer; `attach` holds the sideband socket that carries transcripts and delegations in and
 * Kiln's commentary out. The key stays on the server and never appears in an error.
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  VoiceError,
  type CreateVoiceSession,
  type CreatedVoiceSession,
  type Focus,
  type VoiceCommand,
  type VoiceEvent,
  type VoiceLink,
  type VoiceProvider,
} from "./types";

export const GPT_LIVE_MODEL = "gpt-live-1";
/** GPT-Live takes at most 500 tokens per append; 1800 characters stays under that. */
export const GPT_LIVE_CONTENT_CHARS = 1800;

/** The part of a WebSocket the sideband uses; Node's global WebSocket fits it. */
export interface LiveSocket {
  send(data: string): void;
  close(): void;
  addEventListener(type: "open" | "message" | "close" | "error", listener: (event: { data?: unknown }) => void): void;
}
export type LiveSocketFactory = (url: string, headers: Record<string, string>) => LiveSocket;

export type GptLiveOptions = {
  fetch?: typeof fetch;
  socket?: LiveSocketFactory;
  /** Default https://api.openai.com. */
  baseUrl?: string;
  /** Default wss://api.openai.com. */
  wsBaseUrl?: string;
  /** Event ids for client commands; default random UUIDs. */
  newId?: () => string;
};

/** Node's WebSocket (undici) accepts a `headers` init, which the browser's does not. */
const nodeSocket: LiveSocketFactory = (url, headers) => new WebSocket(url, { headers } as unknown as string[]) as unknown as LiveSocket;

const Created = z.object({ session: z.object({ id: z.string().min(1) }), transport: z.object({ sdp: z.string().min(1) }) });
const ProviderError = z.object({ error: z.object({ message: z.string() }) });

const Transcript = z.object({ delta: z.string(), start_ms: z.number().optional(), end_ms: z.number().optional() });
const WireEvent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("session.started") }),
  Transcript.extend({ type: z.literal("session.input_transcript.delta") }),
  Transcript.extend({ type: z.literal("session.output_transcript.delta") }),
  z.object({ type: z.literal("session.delegation.created"), delegation: z.object({ id: z.string().min(1) }) }),
  z.object({
    type: z.literal("session.closed"),
    usage: z.object({ seconds: z.number().optional(), cost_usd: z.number().optional() }).optional(),
  }),
  z.object({ type: z.literal("error"), error: z.object({ message: z.string() }) }),
]);
const KNOWN = new Set<string>(WireEvent.options.map((o) => o.shape.type.value));

/**
 * A silence this long between two input transcript deltas starts a new utterance. Deltas inside one
 * utterance carry their own spaces; a new utterance gets one, so two of them don't run together.
 */
export const UTTERANCE_GAP_MS = 500;

function parseWire(data: unknown): z.infer<typeof WireEvent> | { type: "unreadable"; wireType: string } | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(String(data));
  } catch {
    return undefined;
  }
  const type = (raw as { type?: unknown } | null)?.type;
  if (typeof type !== "string" || !KNOWN.has(type)) return undefined;
  const parsed = WireEvent.safeParse(raw);
  return parsed.success ? parsed.data : { type: "unreadable", wireType: type };
}

/** Maps one wire frame to a voice event; unknown types, acks and unreadable frames give undefined. */
export function toVoiceEvent(data: unknown): VoiceEvent | undefined {
  return fromWire(parseWire(data));
}

function fromWire(e: ReturnType<typeof parseWire>): VoiceEvent | undefined {
  if (!e) return undefined;
  switch (e.type) {
    case "unreadable":
      return { type: "error", message: `GPT-Live sent an unreadable ${e.wireType} event.` };
    case "session.started":
      return { type: "started" };
    case "session.input_transcript.delta":
      return { type: "input_transcript", text: e.delta };
    case "session.output_transcript.delta":
      return { type: "output_transcript", text: e.delta };
    case "session.delegation.created":
      return { type: "delegation", id: e.delegation.id };
    case "session.closed":
      return e.usage
        ? {
            type: "closed",
            usage: {
              ...(e.usage.seconds !== undefined ? { seconds: e.usage.seconds } : {}),
              ...(e.usage.cost_usd !== undefined ? { costUsd: e.usage.cost_usd } : {}),
            },
          }
        : { type: "closed" };
    case "error":
      return { type: "error", message: e.error.message };
  }
}

const clip = (text: string) => text.slice(0, GPT_LIVE_CONTENT_CHARS);

/** Maps a voice command to its wire command. */
export function toWireCommand(command: VoiceCommand, eventId: string): Record<string, unknown> {
  switch (command.type) {
    case "say":
      return { type: "session.commentary.append", event_id: eventId, delegation_id: command.delegation, content: clip(command.text) };
    case "think":
      return { type: "session.thinking.append", event_id: eventId, delegation_id: command.delegation, content: clip(command.text) };
    case "instruct":
      return { type: "session.instructions.append", event_id: eventId, content: clip(command.text) };
    case "mute":
      return { type: "session.input_audio.mute", event_id: eventId };
    case "unmute":
      return { type: "session.input_audio.unmute", event_id: eventId };
    case "close":
      return { type: "session.close", event_id: eventId };
  }
}

export class GptLiveProvider implements VoiceProvider {
  private readonly baseUrl: string;
  private readonly wsBaseUrl: string;

  constructor(private readonly options: GptLiveOptions = {}) {
    this.baseUrl = (options.baseUrl ?? "https://api.openai.com").replace(/\/+$/, "");
    this.wsBaseUrl = (options.wsBaseUrl ?? "wss://api.openai.com").replace(/\/+$/, "");
  }

  async create(input: CreateVoiceSession): Promise<CreatedVoiceSession> {
    const redact = (text: string) => text.replaceAll(input.apiKey, "[redacted]");
    let res: Response;
    try {
      res = await (this.options.fetch ?? fetch)(`${this.baseUrl}/v1/live/sessions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${input.apiKey}` },
        body: JSON.stringify({
          session: { model: GPT_LIVE_MODEL, instructions: input.instructions, delegation: { type: "client" } },
          transport: { type: "webrtc", sdp: input.sdp },
        }),
      });
    } catch (error) {
      throw new VoiceError("provider_failed", redact(`GPT-Live could not be reached: ${error instanceof Error ? error.message : String(error)}`));
    }
    const text = await res.text().catch(() => "");
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      body = undefined;
    }
    if (res.status !== 201) {
      const reason = ProviderError.safeParse(body).data?.error.message ?? (text.slice(0, 300) || res.statusText);
      throw new VoiceError("provider_failed", redact(`GPT-Live refused the session (${res.status}): ${reason}`));
    }
    const created = Created.safeParse(body);
    if (!created.success) throw new VoiceError("provider_failed", "GPT-Live answered without a session id and SDP.");
    return { sessionId: created.data.session.id, sdp: created.data.transport.sdp };
  }

  attach(sessionId: string, apiKey: string): Promise<VoiceLink> {
    const url = `${this.wsBaseUrl}/v1/live/sessions/${encodeURIComponent(sessionId)}/attach`;
    const socket = (this.options.socket ?? nodeSocket)(url, { Authorization: `Bearer ${apiKey}` });
    const newId = this.options.newId ?? (() => `evt_${randomUUID()}`);
    const listeners = new Set<(event: VoiceEvent) => void>();
    const emit = (event: VoiceEvent) => {
      for (const l of [...listeners]) l(event);
    };
    let open = false;
    let detached = false;
    let ended = false;
    /** Where the person's last transcribed audio ended, to tell a new utterance from the next piece of one. */
    let inputEndMs: number | undefined;

    return new Promise((resolve, reject) => {
      socket.addEventListener("open", () => {
        open = true;
        resolve({
          on(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
          },
          send(command) {
            if (detached || ended) throw new VoiceError("closed", "The voice sideband is closed.");
            socket.send(JSON.stringify(toWireCommand(command, newId())));
          },
          detach() {
            detached = true;
            listeners.clear();
            socket.close();
          },
        });
      });
      socket.addEventListener("message", ({ data }) => {
        if (detached) return;
        const wire = parseWire(data);
        let event = fromWire(wire);
        if (event?.type === "input_transcript" && wire?.type === "session.input_transcript.delta") {
          const newUtterance = inputEndMs !== undefined && wire.start_ms !== undefined && wire.start_ms - inputEndMs >= UTTERANCE_GAP_MS;
          if (newUtterance && !/^\s/.test(event.text)) event = { ...event, text: ` ${event.text}` };
          if (wire.end_ms !== undefined) inputEndMs = wire.end_ms;
        }
        if (event?.type === "closed") ended = true;
        if (event) emit(event);
      });
      socket.addEventListener("error", () => {
        if (!open) reject(new VoiceError("provider_failed", "GPT-Live's sideband connection failed."));
      });
      socket.addEventListener("close", () => {
        if (!open) return reject(new VoiceError("provider_failed", "GPT-Live closed the sideband connection before it opened."));
        if (detached || ended) return;
        ended = true;
        emit({ type: "detached" });
      });
    });
  }
}

/** What GPT-Live is told about its role: the voice of Studio, with Kiln doing all the thinking. */
export function voiceInstructions(focus: Focus): string {
  const where = focus.chat
    ? `The person is in chat ${focus.chat}${focus.app ? ` of App ${focus.app}` : ""}.`
    : focus.app
      ? `The person is looking at App ${focus.app}.`
      : "The person has no App or chat open yet.";
  return [
    "You are the voice of Kiln Studio, where people build apps by talking to coding agents.",
    "You never decide or act yourself and you know nothing about the person's Apps or chats except what Kiln tells you.",
    "Delegate every request to do, change, check or move anything to Kiln, including questions about how work is going.",
    'While Kiln works, acknowledge briefly ("on it", "one moment") and nothing more.',
    "When Kiln gives you something to say, say it in your own words without adding to it. Use what Kiln tells you quietly only to answer later questions.",
    "Keep everything short: one or two sentences.",
    "Never talk over the person. If they start speaking, stop and listen; say updates at the next pause.",
    where,
  ].join("\n");
}
