/**
 * The page's side of the prototype bridge (templates/nextjs/public/kiln-bridge.js). The prototype
 * runs in a frame on another origin, so the two talk with postMessage. Nothing the frame sends is
 * trusted before `readFrameMessage` has checked where it came from and what it is.
 */
import { z } from "zod";

/** What the page sends to the prototype. */
export type ToFrame = { type: "kiln:highlight"; fragment: string } | { type: "kiln:inspect"; on: boolean };

/** What the prototype sends to the page. */
export const FromFrame = z.discriminatedUnion("type", [
  z.object({ type: z.literal("kiln:ready") }),
  z.object({ type: z.literal("kiln:fragment"), fragment: z.string().min(1).max(200) }),
]);
export type FromFrame = z.infer<typeof FromFrame>;

/** A window message, if it is the bridge speaking from this frame; undefined for anything else. */
export function readFrameMessage(event: { source: unknown; data: unknown }, frame: Window | null | undefined): FromFrame | undefined {
  if (!frame || event.source !== frame) return undefined;
  const parsed = FromFrame.safeParse(event.data);
  return parsed.success ? parsed.data : undefined;
}

/**
 * Sends to the prototype's frame; false when there is none. The target origin is open because a
 * sandboxed preview can have an opaque origin; the messages carry a fragment id and nothing else.
 */
export function sendToFrame(frame: Pick<Window, "postMessage"> | null | undefined, message: ToFrame): boolean {
  if (!frame) return false;
  frame.postMessage(message, "*");
  return true;
}

/** How long a "show in the prototype" waits for the frame to load its route before it is dropped. */
export const HIGHLIGHT_WAIT_MS = 15_000;

/** A highlight asked for while the frame was loading: the fragment and when it was asked. */
export type PendingHighlight = { fragment: string; at: number };

/** The fragment to highlight now that the frame is ready, unless it was asked too long ago. */
export function dueHighlight(pending: PendingHighlight | undefined, now: number): string | undefined {
  return pending && now - pending.at <= HIGHLIGHT_WAIT_MS ? pending.fragment : undefined;
}
