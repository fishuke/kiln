/**
 * The merge gate as Studio sees it (ADR-014; contract in docs/specs/merge-gate.md), redeclared
 * structurally so Studio doesn't depend on @kiln/engine. The API passes `kiln.mergeGate`.
 */
export type MergeGateResult = { id: string; state: "deciding" | "merged" | "needs_review" | "closed"; reasons: string[] };

export interface StudioMergeGate {
  readyForReview(input: {
    scope: { kind: "app"; appId: string; team: string };
    repo: string;
    number: number;
    by: string;
    areas?: string[];
    tests?: "passed" | "failed" | "none";
    preview?: { url?: string; status: "ready" | "failed" | "none" };
    link?: string;
    pullRequestId: string;
  }): Promise<MergeGateResult>;
  pullRequestClosed(input: { repo: string; number: number; merged: boolean; by?: string }): unknown;
}

/** For tests: answers with `next` and records every call. */
export class FakeStudioMergeGate implements StudioMergeGate {
  readonly calls: Parameters<StudioMergeGate["readyForReview"]>[0][] = [];
  readonly closed: Parameters<StudioMergeGate["pullRequestClosed"]>[0][] = [];
  next: Omit<MergeGateResult, "id"> = { state: "needs_review", reasons: ["a person reviews every change"] };

  async readyForReview(input: Parameters<StudioMergeGate["readyForReview"]>[0]): Promise<MergeGateResult> {
    this.calls.push(input);
    return { id: `review_${this.calls.length}`, ...this.next };
  }

  pullRequestClosed(input: Parameters<StudioMergeGate["pullRequestClosed"]>[0]) {
    this.closed.push(input);
  }
}
