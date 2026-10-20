import type { AgentActivity } from "@kiln/integrations";

/** A recorded run event, as published on the bus (`run.event`). */
export type StreamedRunEvent = { type: string; text?: string; data?: unknown };

const MAX_BODY = 2000;
const MAX_PARAMETER = 200;
const MAX_RESULT = 500;

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/** The one input field that says what a tool call is about: a path, a command, a pattern or a URL. */
export function toolParameter(input: unknown): string {
  if (input === undefined || input === null) return "";
  if (typeof input !== "object") return clip(String(input), MAX_PARAMETER);
  const o = input as Record<string, unknown>;
  for (const key of ["file_path", "command", "pattern", "url", "query", "path", "description", "prompt"]) {
    if (typeof o[key] === "string" && o[key]) return clip(o[key] as string, MAX_PARAMETER);
  }
  return clip(JSON.stringify(input), MAX_PARAMETER);
}

type Pending = { action: string; parameter: string };

/**
 * Turns a run's events into Linear agent activities, in order: messages and thinking as thoughts,
 * each tool call as one action carrying its result, errors and failed runs as errors.
 */
export class LinearActivityStream {
  private readonly pending = new Map<string, Pending>();
  private readonly errored = new Set<string>();

  constructor(private readonly post: (runId: string, activity: AgentActivity) => Promise<void>) {}

  /** `failure` is the run's error message, used when a failed run recorded no error event. */
  async push(runId: string, e: StreamedRunEvent, failure?: string) {
    if (e.type === "tool_result") {
      const call = this.pending.get(runId);
      this.pending.delete(runId);
      if (!call) return;
      const failed = (e.data as { isError?: boolean } | undefined)?.isError;
      const output = clip((e.text ?? "").trim(), MAX_RESULT);
      await this.post(runId, { type: "action", body: "", ...call, ...(output || failed ? { result: failed ? `Failed: ${output}` : output } : {}) });
      return;
    }
    const activity = this.activity(runId, e, failure);
    if (activity === "skip") return;
    await this.flush(runId);
    if (e.type === "tool_call") {
      this.pending.set(runId, { action: e.text || "tool", parameter: toolParameter(e.data) });
      return;
    }
    if (e.type === "finished") {
      this.errored.delete(runId);
      if (activity) await this.post(runId, activity);
      return;
    }
    if (activity) await this.post(runId, activity);
  }

  private async flush(runId: string) {
    const call = this.pending.get(runId);
    if (!call) return;
    this.pending.delete(runId);
    await this.post(runId, { type: "action", body: "", ...call });
  }

  private activity(runId: string, e: StreamedRunEvent, failure?: string): AgentActivity | undefined | "skip" {
    const text = (e.text ?? "").trim();
    switch (e.type) {
      case "message":
      case "reasoning":
        return text ? { type: "thought", body: clip(text, MAX_BODY) } : "skip";
      case "started":
        return { type: "thought", body: clip(`Started ${text.replace(/ on [^ ]+$/, "")}`, MAX_BODY) };
      case "tool_call":
        return undefined;
      case "error":
        this.errored.add(runId);
        return { type: "error", body: clip(text || "error", MAX_BODY) };
      case "finished":
        if (["failed", "error"].includes(text) && !this.errored.has(runId)) return { type: "error", body: clip(`Run failed: ${failure ?? text}`, MAX_BODY) };
        return undefined;
      default:
        return "skip";
    }
  }
}
