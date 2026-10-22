import type { AppPullRequest } from "./types";

/**
 * The merge gate as Studio sees it (ADR-014; the one contract in docs/specs/studio.md "Ship flow"),
 * redeclared structurally so Studio doesn't depend on @kiln/engine. The API passes `kiln.mergeGate`.
 * The gate, not ship, adds the reviewers' Inbox item and raises the needs-you event.
 */
export type MergeGateOutcome = { outcome: "merged" } | { outcome: "review"; reasons: string[] };

export interface StudioMergeGate {
  readyForReview(pr: AppPullRequest): Promise<MergeGateOutcome>;
  pullRequestClosed(pr: AppPullRequest): unknown;
}

/** For tests: answers with `next` and records every call. */
export class FakeStudioMergeGate implements StudioMergeGate {
  readonly asked: AppPullRequest[] = [];
  readonly closed: AppPullRequest[] = [];
  next: MergeGateOutcome = { outcome: "review", reasons: ["a person reviews every change"] };

  async readyForReview(pr: AppPullRequest): Promise<MergeGateOutcome> {
    this.asked.push(pr);
    return this.next;
  }

  pullRequestClosed(pr: AppPullRequest) {
    this.closed.push(pr);
  }
}
