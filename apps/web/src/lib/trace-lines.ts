/** Titles and statuses for the transcript's Trace lines (reasoning, work, subagents). Pure. */
import type { Step } from "./run-detail";
import { shortDuration } from "./run-tree";

export type TraceStatus = "running" | "error" | "pending";

export function reasoningTitle(durationMs: number | undefined): string {
  return durationMs ? `Reasoned for ${shortDuration(durationMs)}` : "Reasoned";
}

export function workTitle(durationMs: number, working: boolean): string {
  return `${working ? "Working" : "Worked"} for ${shortDuration(durationMs)}`;
}

/** "Ran 2 commands · Called 1 tool": read to screen readers after the work title. */
export function workSummary(steps: Step[]): string {
  const commands = steps.filter((s) => s.kind === "command").length;
  const tools = steps.filter((s) => s.kind === "tool").length;
  const parts = [];
  if (commands) parts.push(`Ran ${commands} command${commands === 1 ? "" : "s"}`);
  if (tools) parts.push(`Called ${tools} tool${tools === 1 ? "" : "s"}`);
  return parts.join(" · ");
}

export function stepStatus(step: Step): TraceStatus | undefined {
  return step.isError || step.kind === "error" ? "error" : undefined;
}

export function subagentsTitle(n: number): string {
  return `Launched ${n} subagent${n === 1 ? "" : "s"}`;
}
