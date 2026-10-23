/** Typed event contracts shared by the engine, API, integrations and web. */

export type WorkItemState =
  | "received"
  | "triaging"
  | "planning"
  | "awaiting_spec"
  | "building"
  | "reviewing"
  | "awaiting_preview"
  | "handed_off"
  | "complete"
  | "blocked"
  | "cancelled"
  | "failed";

export type KilnEventMap = {
  "work_item.created": { workItemId: string; factory: string; source: string };
  "work_item.stage_changed": { workItemId: string; factory: string; from: WorkItemState; to: WorkItemState; reason: string };
  "run.started": { runId: string; workItemId?: string; agent: string; harness: string };
  "run.event": { runId: string; seq: number; type: string; text?: string; data?: unknown };
  "run.finished": { runId: string; outcome: "succeeded" | "failed" | "cancelled"; costUsd: number };
  "gate.opened": { gateId: string; workItemId: string; kind: string; assignees: string[] };
  "gate.decided": { gateId: string; workItemId: string; decision: string; by: string };
  "gate.nudged": { gateId: string; workItemId: string };
  "score.recorded": { runId: string; scorer: string; label: string; score: number; passed: boolean };
  "pull_request.opened": { workItemId?: string; repo: string; number: number; url: string; branch: string };
  "pull_request.merged": { repo: string; number: number; branch: string };
  "definition.applied": { factory: string; sha: string; canaryPercent?: number };
  "definition.rejected": { factory: string; sha: string; errors: number };
  "decision.made": { decision: string; action: string; provider: string; workItemId?: string };
  "self_improvement.proposed": { factory: string; agent: string; url: string };
  "message.posted": { channel: string; thread?: string; text: string };
  "studio.turn_started": { appId: string; chatId: string; turnId: string; priority: "progress" };
  "studio.turn_finished": { appId: string; chatId: string; turnId: string; title?: string; summary?: string; changed: boolean; priority: "finished" };
  "studio.version_created": { appId: string; versionId: string; title: string; kind: "initial" | "apply" | "restore"; priority: "finished" };
  "studio.needs_you": { appId: string; chatId: string; question: string; reason: "question" | "conflict" | "failed" | "approval"; priority: "needs_you" };
  /** A command a chat's run waited on (a command-approval gate) was allowed or blocked; `by` is the person, absent when nobody answered in time. */
  "studio.approval_decided": { appId: string; chatId: string; turnId: string; decision: "allowed" | "blocked"; by?: string; priority: "progress" };
  /** An App's setup (scaffold or clone, install, first commit) failed; the App stays failed until it is retried or deleted. `error` has the App's secret values redacted. */
  "studio.app_failed": { appId: string; error: string; priority: "needs_you" };
  /**
   * A preview's dev server didn't become ready, or exited. chatId or versionId names the preview. `output` is the
   * dev server's last 40 output lines (stdout and stderr); `reason` and `output` have the App's secret values redacted.
   */
  "studio.preview_failed": { appId: string; chatId?: string; versionId?: string; port: number; reason: string; output: string; priority: "progress" };
  /** An App's pull request changed state; never needs_you (the merge gate's merge_gate.review_updated is the one needs-you event for a review). */
  "studio.pull_request_state_changed": {
    appId: string;
    pullRequestId: string;
    state: "uat" | "ready_for_review" | "waiting_for_review" | "merged" | "cancelled";
    url: string;
    priority: "finished";
  };
  /** ADR-014: a pull request marked ready for review was merged by the gate, sent to a person, merged later or closed. */
  "merge_gate.review_updated": {
    reviewId: string;
    appId?: string;
    factory?: string;
    pullRequestId?: string;
    repo: string;
    number: number;
    state: "deciding" | "merged" | "needs_review" | "closed";
    priority: "needs_you" | "finished";
  };
};

/** How urgently a Studio event should reach the person (ADR-012): spoken, a badge, or silent. */
export type StudioPriority = "needs_you" | "finished" | "progress";

export type KilnEventType = keyof KilnEventMap;
export type KilnEvent<T extends KilnEventType = KilnEventType> = { type: T; at: string; payload: KilnEventMap[T] };

type Handler<T extends KilnEventType> = (event: KilnEvent<T>) => void | Promise<void>;

export interface EventBus {
  publish<T extends KilnEventType>(type: T, payload: KilnEventMap[T]): KilnEvent<T>;
  subscribe<T extends KilnEventType>(type: T | "*", handler: Handler<T>): () => void;
}

/**
 * In-process bus with an outbox: every published event is kept in order so a durable
 * transport (Postgres outbox → NATS JetStream in production) can drain it.
 */
export class InMemoryEventBus implements EventBus {
  readonly outbox: KilnEvent[] = [];
  private readonly handlers = new Map<string, Set<Handler<KilnEventType>>>();

  constructor(private readonly now: () => Date = () => new Date()) {}

  publish<T extends KilnEventType>(type: T, payload: KilnEventMap[T]): KilnEvent<T> {
    const event: KilnEvent<T> = { type, at: this.now().toISOString(), payload };
    this.outbox.push(event as KilnEvent);
    for (const key of [type, "*"]) {
      for (const handler of this.handlers.get(key) ?? []) {
        void Promise.resolve(handler(event as KilnEvent)).catch((err) => {
          console.error(`event handler for ${type} failed`, err);
        });
      }
    }
    return event;
  }

  subscribe<T extends KilnEventType>(type: T | "*", handler: Handler<T>): () => void {
    const set = this.handlers.get(type) ?? new Set();
    set.add(handler as Handler<KilnEventType>);
    this.handlers.set(type, set);
    return () => set.delete(handler as Handler<KilnEventType>);
  }

  drain(): KilnEvent[] {
    return this.outbox.splice(0, this.outbox.length);
  }
}
