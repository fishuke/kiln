/**
 * The merge gate as Studio sees it (ADR-014; docs/specs/studio.md "Merge gate (ADR-014)"),
 * redeclared structurally so Studio doesn't depend on @kiln/engine. The API passes `kiln.mergeGate`.
 * The gate, not ship, adds the reviewers' Inbox item and raises the needs-you event.
 */
export type MergeGateOutcome = { outcome: "merged" } | { outcome: "review"; reasons: string[] };

export type ReadyForReviewInput = {
  scope: { kind: "app"; appId: string; team: string };
  repo: string;
  number: number;
  by: string;
  pullRequestId: string;
  preview?: { url?: string; status: "ready" | "failed" | "none" };
  tests?: "passed" | "failed" | "none";
  areas?: string[];
  link?: string;
};

export type PullRequestClosedInput = { repo: string; number: number; merged: boolean; by?: string };

export interface StudioMergeGate {
  readyForReview(input: ReadyForReviewInput): Promise<MergeGateOutcome>;
  pullRequestClosed(input: PullRequestClosedInput): unknown;
}

/** For tests: answers with `next` and records every call. */
export class FakeStudioMergeGate implements StudioMergeGate {
  readonly asked: ReadyForReviewInput[] = [];
  readonly closed: PullRequestClosedInput[] = [];
  next: MergeGateOutcome = { outcome: "review", reasons: ["a person reviews every change"] };

  async readyForReview(input: ReadyForReviewInput): Promise<MergeGateOutcome> {
    this.asked.push(input);
    return this.next;
  }

  pullRequestClosed(input: PullRequestClosedInput) {
    this.closed.push(input);
  }
}
