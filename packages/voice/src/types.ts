/**
 * Talk to Studio (ADR-013). GPT-Live does the talking; Kiln does the thinking. This file is the
 * contract between the voice provider, the conductor, the narrator and the API route.
 */
import type { ClientAction, StudioToolName } from "@kiln/studio";
import { z } from "zod";

export interface Clock {
  now(): Date;
}

export class VoiceError extends Error {
  constructor(
    readonly code: "no_openai_key" | "provider_failed" | "not_found" | "closed",
    message: string,
  ) {
    super(message);
    this.name = "VoiceError";
  }
}

// ---- Provider: the live voice session and its sideband ----

export type CreateVoiceSession = {
  apiKey: string;
  /** The browser's WebRTC offer. */
  sdp: string;
  /** What GPT-Live is told about its role; see `voiceInstructions`. */
  instructions: string;
};
export type CreatedVoiceSession = { sessionId: string; sdp: string };

/** What the sideband reports, normalized from the provider's wire events. */
export type VoiceEvent =
  | { type: "started" }
  | { type: "input_transcript"; text: string }
  | { type: "output_transcript"; text: string }
  /** The voice hands a request to Kiln; the person's words are in the input transcript. */
  | { type: "delegation"; id: string }
  | { type: "closed"; usage?: { seconds?: number; costUsd?: number } }
  /** The sideband dropped before the session ended; the session may still run, so attach again. */
  | { type: "detached" }
  | { type: "error"; message: string };

/** What Kiln tells the live session. `delegation` answers that request; null is session-wide. */
export type VoiceCommand =
  /** Something to say out loud (the voice may rephrase it). */
  | { type: "say"; text: string; delegation: string | null }
  /** Context the voice can use later without saying it now. */
  | { type: "think"; text: string; delegation: string | null }
  | { type: "instruct"; text: string }
  | { type: "mute" }
  | { type: "unmute" }
  | { type: "close" };

export interface VoiceLink {
  on(listener: (event: VoiceEvent) => void): () => void;
  send(command: VoiceCommand): void;
  /** Drops the sideband connection without ending the session. */
  detach(): void;
}

export interface VoiceProvider {
  create(input: CreateVoiceSession): Promise<CreatedVoiceSession>;
  attach(sessionId: string, apiKey: string): Promise<VoiceLink>;
}

// ---- Thinker: the fast decision model behind the conductor ----

export const ConductorCall = z.discriminatedUnion("tool", [
  /** Send the person's words, verbatim, to a chat (default: the focused one). The model never writes the text. */
  z.object({ tool: z.literal("relay"), chat: z.string().optional() }),
  /** Answer a pending confirmation (apply, restore, ship). */
  z.object({ tool: z.literal("confirm"), yes: z.boolean() }),
  /** Any other Studio tool by name, with its input. `send` is not allowed: use relay. */
  z.object({ tool: z.literal("studio"), name: z.string(), input: z.record(z.string(), z.unknown()) }),
  /** Nothing to do: just say this. */
  z.object({ tool: z.literal("reply"), text: z.string().min(1) }),
]);
export type ConductorCall = z.infer<typeof ConductorCall>;

export type ThinkInput = {
  /** The person's words since the last delegation. */
  words: string;
  /** Recent conversation, oldest first. */
  transcript: TranscriptLine[];
  focus: Focus;
  /** A short digest of the team's Apps and chats (from Studio's status tool). */
  status: string;
  /** An action waiting for a spoken yes or no. */
  pending?: PendingAction;
};

export interface Thinker {
  think(input: ThinkInput): Promise<ConductorCall[]>;
}

// ---- Conductor and narrator results ----

export type Focus = { app?: string; chat?: string };
export type PendingAction = { name: Extract<StudioToolName, "apply" | "restore" | "ship">; input: Record<string, unknown>; asked: string };

export type ConductorResult = {
  say?: string;
  think?: string;
  client: ClientAction[];
  focus: Focus;
  pending?: PendingAction;
};

export type Badge = { appId: string; chatId?: string; text: string; priority: "needs_you" | "finished" };

export type NarratorInput = { focus: Focus; quiet: boolean; idle: boolean };
export type Narration = { command?: VoiceCommand; badge?: Badge };

// ---- Session: runtime state in the Store ----

export const TranscriptLine = z.object({ role: z.enum(["person", "voice"]), text: z.string(), at: z.string() });
export type TranscriptLine = z.infer<typeof TranscriptLine>;

export const VoiceSession = z.object({
  id: z.string(),
  team: z.string(),
  by: z.string(),
  /** The provider's live session; a new one on every resume. */
  liveSessionId: z.string().optional(),
  status: z.enum(["connecting", "live", "idle", "closed"]),
  focus: z.object({ app: z.string().optional(), chat: z.string().optional() }),
  quiet: z.boolean(),
  transcript: z.array(TranscriptLine),
  pending: z.object({ name: z.enum(["apply", "restore", "ship"]), input: z.record(z.string(), z.unknown()), asked: z.string() }).optional(),
  seconds: z.number(),
  costUsd: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type VoiceSession = z.infer<typeof VoiceSession>;

/** Events the API streams to the browser (GET /api/v1/voice/sessions/{id}/events). */
export type VoiceStreamEvent =
  | { event: "client"; data: ClientAction }
  | { event: "transcript"; data: { role: TranscriptLine["role"]; text: string } }
  | { event: "badge"; data: Badge }
  | { event: "state"; data: { status: VoiceSession["status"]; focus: Focus; quiet: boolean } };

/** Session limits (ADR-013: sessions stop listening when idle and have a limit like any run). */
export const VOICE_LIMITS = { idleSeconds: 120, maxSeconds: 30 * 60, transcriptLines: 40 } as const;
