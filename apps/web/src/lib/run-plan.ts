/**
 * A task's plan as a checklist: one line per stage of the work item's plan, with what happened in
 * it, and the one thing the task waits for now. Pure functions only: the pages and the tests share them.
 */
import type { RunLike } from "./run-tree";

export type PlanStageLike = { id: string; kind: string; agent?: string };
export type PlanLike = { cursor: number; stages: PlanStageLike[] };

export type TaskLineStatus = "done" | "active" | "waiting" | "failed" | "todo";
export type TaskLine = { id: string; label: string; status: TaskLineStatus; attempts: number };
export type PlanView = { tasks: TaskLine[]; done: number; total: number; current?: string; waiting?: string };

const TASK_LABEL: Record<string, string> = {
  triage: "Triage the request",
  spec: "Write the spec",
  build: "Implement the change",
  verify: "Verify it works",
  preview: "Deploy a preview",
  review: "Review the change",
  handoff: "Hand off the pull request",
};

/** The short name of a stage, as the Runs list and the foreman's updates say it. */
const STAGE_NAME: Record<string, string> = { triage: "Triage", spec: "Spec", build: "Implement", verify: "Verify", preview: "Preview", review: "Review", handoff: "Hand off" };

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
export const stageName = (s: PlanStageLike) => STAGE_NAME[s.kind] ?? cap(s.id);
const taskLabel = (s: PlanStageLike) => TASK_LABEL[s.kind] ?? cap(s.id.replace(/[-_]/g, " "));

const WAITING_ON_PERSON = ["awaiting_spec", "awaiting_preview", "handed_off"];
const FINISHED = ["complete", "merged"];

export function planView(input: {
  state: string;
  plan?: PlanLike;
  blockedReason?: string;
  runs: Pick<RunLike, "agent" | "stage" | "status" | "startedAt">[];
  openGates?: { title: string }[];
}): PlanView | undefined {
  const { plan, state } = input;
  if (!plan?.stages.length) return undefined;
  const finished = FINISHED.includes(state);
  const tasks = plan.stages.map((s, i): TaskLine => {
    const attempts = input.runs.filter((r) => r.stage === s.id).length;
    let status: TaskLineStatus = "todo";
    if (finished || i < plan.cursor) status = "done";
    else if (i === plan.cursor) {
      if (state === "failed") status = "failed";
      else if (state === "blocked" || WAITING_ON_PERSON.includes(state)) status = "waiting";
      else if (state !== "cancelled") status = "active";
    }
    return { id: s.id, label: taskLabel(s), status, attempts };
  });
  // Handed off: the last stage (the hand-off itself) is done; the person merges.
  if (state === "handed_off" && tasks.at(-1)?.id === plan.stages[plan.cursor]?.id) tasks.at(-1)!.status = "done";
  const at = plan.stages[Math.min(plan.cursor, plan.stages.length - 1)];
  return {
    tasks,
    done: tasks.filter((t) => t.status === "done").length,
    total: tasks.length,
    current: finished || !at ? undefined : stageName(at),
    waiting: waitingFor(input),
  };
}

/** What the task waits for now, in words; undefined when it waits for nothing. */
export function waitingFor(input: { state: string; blockedReason?: string; runs: Pick<RunLike, "agent" | "status" | "startedAt">[]; openGates?: { title: string }[] }): string | undefined {
  if (FINISHED.includes(input.state) || input.state === "cancelled" || input.state === "failed") return undefined;
  const running = [...input.runs].filter((r) => r.status === "running").sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
  if (running) return `Waiting for ${running.agent} agent…`;
  const gate = input.openGates?.[0];
  if (gate) return `Waiting for you: ${gate.title}`;
  // Any other blocked reason is a stop, which the page already shows as its own banner.
  if (input.blockedReason && /^waiting for /i.test(input.blockedReason)) return `${cap(input.blockedReason)}…`;
  return undefined;
}
