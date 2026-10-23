import type { ClientAction, Preview, StatusReport, ToolResult } from "@kiln/studio";
import type { Clock, ConductorCall, ConductorResult, Focus, PendingAction, Thinker, TranscriptLine } from "./types";

/** The session state one delegation needs; `status` is fetched with the status tool when not given. */
export type ConductorState = { focus: Focus; transcript: TranscriptLine[]; pending?: PendingAction; status?: string };

export type ConductorOptions = {
  thinker: Thinker;
  /** Studio's runTool for the session's team, with `via: "voice"`. */
  runTool: (name: string, input: Record<string, unknown>) => Promise<ToolResult>;
  clock: Clock;
};

/** Tools that change the main line or the outside world; each needs a spoken yes first. */
const CONFIRM = new Set<string>(["apply", "restore", "ship"]);

/** How a failed tool is named in "I couldn't …". */
const DOING: Record<string, string> = {
  status: "check that",
  open_app: "open that app",
  new_chat: "start that chat",
  send: "send that",
  apply: "apply that",
  restore: "restore that",
  bookmark: "bookmark that",
  look: "look at that",
  stop: "stop that",
  ship: "ship that",
  set_ship_mode: "change the ship mode",
  focus: "move there",
  show: "show that",
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Studio's status read aloud: per app, what's working, what needs the person and the latest version. */
export function describeStatus(report: StatusReport, withIds = false): string {
  if (!report.apps.length) return "There are no apps yet.";
  return report.apps
    .map((a) => {
      const parts = [a.working.length ? `${plural(a.working.length, "chat")} working${withIds ? ` (${a.working.join(", ")})` : ""}` : "idle"];
      for (const n of a.needsYou) parts.push(`needs you${withIds ? ` in ${n.chatId}` : ""}: ${n.question}`);
      parts.push(`latest: ${a.latest?.title ?? "nothing yet"}`);
      return `${a.name}${withIds ? ` (${a.id})` : ""}: ${parts.join("; ")}.`;
    })
    .join(" ");
}

function describePreview(p: Preview): string {
  return p.status === "ready" ? "The preview is ready." : p.status === "starting" ? "The preview is still starting." : "The preview failed to start.";
}

function question(p: Omit<PendingAction, "asked">): string {
  const i = p.input;
  if (p.name === "apply") return "Apply this chat's changes to the main line? Say yes or no.";
  if (p.name === "restore") return "Restore that version as a new version? Say yes or no.";
  return i.state === "cancelled"
    ? "Cancel the pull request? Say yes or no."
    : i.state === "ready_for_review"
      ? "Mark the pull request ready for review? Say yes or no."
      : "Open or update the pull request? Say yes or no.";
}

/** What a confirmed action says when it ran. */
function confirmed(name: PendingAction["name"], data: unknown): string {
  if (name === "apply") {
    const r = data as { ok: boolean; version?: { title: string }; conflict?: string[] };
    if (r.ok && r.version) return `Applied: ${r.version.title}.`;
    if (r.conflict) return `Applying conflicts in ${r.conflict.join(", ")}.`;
    return "There was nothing to apply.";
  }
  if (name === "restore") return `Restored: ${(data as { title?: string }).title ?? "done"}.`;
  const pr = data as { state?: string };
  return pr.state ? `Done. The pull request is ${pr.state.replaceAll("_", " ")}.` : "Done.";
}

/**
 * Handles one delegation from the live voice (ADR-013): asks the thinker what to do with the person's
 * words and runs its calls through Studio's tools. Kiln relays the person's words verbatim; the model
 * only picks where they go. Apply, restore and ship wait for a spoken yes on the next delegation.
 */
export class Conductor {
  constructor(private readonly options: ConductorOptions) {}

  async handle(state: ConductorState, words: string): Promise<ConductorResult> {
    const says: string[] = [];
    const thinks: string[] = [];
    const client: ClientAction[] = [];
    let focus: Focus = { ...state.focus };
    let pending: PendingAction | undefined;
    const done = (): ConductorResult => ({
      ...(says.length ? { say: says.join(" ") } : {}),
      ...(thinks.length ? { think: thinks.join(" ") } : {}),
      client,
      focus,
      ...(pending ? { pending } : {}),
    });
    const run = async (name: string, input: Record<string, unknown>): Promise<ToolResult> => {
      const r = await this.options.runTool(name, input);
      if (!r.ok) says.push(`I couldn't ${DOING[name] ?? "do that"}: ${r.error}`);
      else if (r.client) {
        client.push(r.client);
        if ("focus" in r.client) focus = { ...r.client.focus };
      }
      return r;
    };

    let calls: ConductorCall[];
    try {
      calls = await this.options.thinker.think({
        words,
        transcript: state.transcript,
        focus,
        status: state.status ?? (await this.status()),
        ...(state.pending ? { pending: state.pending } : {}),
      });
    } catch (err) {
      says.push(`I couldn't work that out: ${err instanceof Error ? err.message : String(err)}`);
      return done();
    }

    for (const call of calls) {
      switch (call.tool) {
        case "relay": {
          const chat = call.chat ?? focus.chat;
          if (!chat) says.push("Which chat should I send that to?");
          else if (words.trim()) await run("send", { chat, text: words });
          break;
        }
        case "confirm": {
          // A pending action lives for one delegation; anything but a yes drops it.
          const p = state.pending;
          if (!p) break;
          if (!call.yes) says.push("Okay, I won't.");
          else {
            const r = await run(p.name, p.input);
            if (r.ok) says.push(confirmed(p.name, r.data));
          }
          break;
        }
        case "reply":
          says.push(call.text);
          break;
        case "studio": {
          const { name, input } = call;
          if (name === "send") break; // Never the model's words; relay sends the person's.
          if (CONFIRM.has(name)) {
            const asked = question({ name: name as PendingAction["name"], input });
            pending = { name: name as PendingAction["name"], input, asked };
            says.push(asked);
            return done();
          }
          const r = await run(name, input);
          if (!r.ok) break;
          if (name === "status") says.push(describeStatus(r.data as StatusReport));
          else if (name === "look") says.push(describePreview(r.data as Preview));
          else if (name === "open_app") says.push(`Opening ${(r.data as { name: string }).name}.`);
          else thinks.push(`Done: ${name}.`);
          break;
        }
      }
    }
    return done();
  }

  /** The status digest for the thinker, with ids so it can name apps and chats. */
  private async status(): Promise<string> {
    const r = await this.options.runTool("status", {});
    return r.ok ? describeStatus(r.data as StatusReport, true) : "unavailable";
  }
}
