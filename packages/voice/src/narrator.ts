import { z } from "zod";
import type { Badge, Narration, NarratorInput } from "./types";

/** A bus event as the route receives it; payloads are parsed here, so anything malformed is dropped. */
export type NarratedEvent = { type: string; payload: unknown };

const NeedsYou = z.object({ appId: z.string(), chatId: z.string().optional(), question: z.string() });
const AppFailed = z.object({ appId: z.string(), error: z.string() });
const TurnFinished = z.object({ appId: z.string(), chatId: z.string(), title: z.string(), summary: z.string().optional() });
const VersionCreated = z.object({ appId: z.string(), title: z.string() });
const PullRequestChanged = z.object({ appId: z.string(), state: z.string() });

/**
 * What the voice hears about a Studio event (ADR-013 priorities). Needs-you is said at the next pause
 * (thought in quiet mode); a finished turn is said only in the focused chat or while the person is idle,
 * otherwise thought, so the voice can answer "how's it going?"; progress is never told. Needs-you and
 * finished events also come back as a badge for the browser.
 */
export function narrate(event: NarratedEvent, input: NarratorInput): Narration {
  const tell = (speak: boolean, text: string, badge: Badge): Narration => ({
    command: { type: speak && !input.quiet ? "say" : "think", text, delegation: null },
    badge,
  });
  switch (event.type) {
    case "studio.needs_you": {
      const e = NeedsYou.safeParse(event.payload);
      if (!e.success) return {};
      const { appId, chatId, question } = e.data;
      return tell(true, question, { appId, ...(chatId ? { chatId } : {}), text: question, priority: "needs_you" });
    }
    case "studio.app_failed": {
      const e = AppFailed.safeParse(event.payload);
      if (!e.success) return {};
      const text = `An app failed to set up: ${e.data.error}`;
      return tell(true, text, { appId: e.data.appId, text, priority: "needs_you" });
    }
    case "studio.turn_finished": {
      const e = TurnFinished.safeParse(event.payload);
      if (!e.success) return {};
      const { appId, chatId, title, summary } = e.data;
      const text = summary ? `${title}: ${summary}` : title;
      return tell(chatId === input.focus.chat || input.idle, text, { appId, chatId, text: title, priority: "finished" });
    }
    case "studio.version_created": {
      const e = VersionCreated.safeParse(event.payload);
      if (!e.success) return {};
      const text = `New version: ${e.data.title}`;
      return tell(false, text, { appId: e.data.appId, text, priority: "finished" });
    }
    case "studio.pull_request_state_changed": {
      const e = PullRequestChanged.safeParse(event.payload);
      if (!e.success) return {};
      const text = `The pull request is now ${e.data.state.replaceAll("_", " ")}.`;
      return tell(false, text, { appId: e.data.appId, text, priority: "finished" });
    }
    default:
      // Progress (turn_started, approval_decided, preview_failed) and anything else: nothing to tell.
      return {};
  }
}
