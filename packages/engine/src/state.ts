import type { WorkItem, WorkItemState } from "./types";

const ACTIVE: WorkItemState[] = ["received", "triaging", "planning", "awaiting_spec", "building", "reviewing", "awaiting_preview", "handed_off", "blocked"];

/** Allowed transitions. `complete` is reachable only from handed_off, and only with a completion record. */
export const TRANSITIONS: Record<WorkItemState, WorkItemState[]> = {
  received: ["triaging", "planning", "building", "blocked", "cancelled", "failed"],
  triaging: ["planning", "building", "blocked", "cancelled", "failed"],
  planning: ["planning", "awaiting_spec", "building", "blocked", "cancelled", "failed"],
  awaiting_spec: ["planning", "building", "blocked", "cancelled"],
  building: ["building", "reviewing", "awaiting_preview", "handed_off", "blocked", "cancelled", "failed"],
  reviewing: ["building", "awaiting_preview", "handed_off", "blocked", "cancelled", "failed"],
  awaiting_preview: ["building", "reviewing", "handed_off", "blocked", "cancelled"],
  handed_off: ["complete", "building", "reviewing", "blocked", "cancelled"],
  blocked: ["received", "triaging", "planning", "awaiting_spec", "building", "reviewing", "awaiting_preview", "handed_off", "cancelled", "failed"],
  complete: [],
  cancelled: [],
  failed: ["received", "building"],
};

export class TransitionError extends Error {}

export function isActive(state: WorkItemState) {
  return ACTIVE.includes(state);
}

/** Validates a transition and enforces the completion invariant. Returns the updated item. */
export function transition(item: WorkItem, to: WorkItemState, at: string): WorkItem {
  if (item.state === to && to !== "building" && to !== "planning") return item;
  if (!TRANSITIONS[item.state].includes(to)) {
    throw new TransitionError(`cannot move ${item.id} from ${item.state} to ${to}`);
  }
  if (to === "complete") {
    if (!item.completion || !["merge", "human"].includes(item.completion.by) || !item.completion.ref) {
      throw new TransitionError(`${item.id} cannot complete without a merge event or human confirmation`);
    }
  }
  return { ...item, state: to, updatedAt: at, completedAt: to === "complete" ? at : item.completedAt };
}
