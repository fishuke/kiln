import type { PersonForge, PullRequestFile, RepoRef, ReviewInput } from "@kiln/integrations";
import type { Kiln } from "./kiln";
import { isActive } from "./state";
import type { WorkItem } from "./types";

export class ReviewError extends Error {}

/**
 * Reviewing and merging a factory pull request from Kiln (ADR-010). The diff is read with the
 * forge's own identity; reviews and merges run as the person, with their linked account's token.
 */
export class ReviewService {
  constructor(private readonly k: Kiln) {}

  /** Whether this person can review in Kiln: a linked GitHub account with a token. */
  account(userId: string): { linked: false } | { linked: true; login: string } {
    const t = this.k.identities.personToken(userId, "github");
    return t ? { linked: true, login: t.login } : { linked: false };
  }

  /** Handed-off work no person needs to review: it only waits for someone to merge it. */
  readyToMerge(factory?: string): WorkItem[] {
    return this.k.workflow.list().filter((w) => w.state === "handed_off" && w.pr && w.review?.needsHuman === false && (!factory || w.factory === factory));
  }

  async files(workItemId: string): Promise<PullRequestFile[]> {
    const { repo, number } = this.target(workItemId);
    if (!this.k.forge.pullRequestFiles) throw new ReviewError(`${this.k.forge.name} does not show pull request diffs in Kiln yet`);
    return this.k.forge.pullRequestFiles(repo, number);
  }

  async submit(workItemId: string, userId: string, input: ReviewInput) {
    const { wi, repo, number } = this.target(workItemId);
    const { forge, login } = this.person(userId);
    if (input.event !== "APPROVE" && !input.body?.trim() && !input.comments?.length) throw new ReviewError("Write what to change, or comment on a line");
    const review = await this.call(() => forge.submitReview(repo, number, input));
    if (input.event === "REQUEST_CHANGES" || (input.event === "COMMENT" && input.comments?.length)) {
      const text = [input.body?.trim(), ...(input.comments ?? []).map((c) => `- ${c.path}:${c.line}: ${c.body}`)].filter(Boolean).join("\n");
      if (isActive(wi.state)) await this.k.workflow.onReviewSubmitted(wi.pr!.repo, number, text, login, input.body ?? "");
    }
    return review;
  }

  /** Merges as the person. The forge's merge webhook may arrive too; completing twice is a no-op. */
  async merge(workItemId: string, userId: string) {
    const { repo, number, wi } = this.target(workItemId);
    const { forge, login } = this.person(userId);
    const pr = await this.call(() => forge.merge(repo, number));
    await this.k.workflow.onPullRequestMerged(wi.pr!.repo, number, login);
    return pr;
  }

  private target(workItemId: string): { wi: WorkItem; repo: RepoRef; number: number } {
    const wi = this.k.workflow.get(workItemId);
    if (!wi) throw new ReviewError(`no task ${workItemId}`);
    if (!wi.pr) throw new ReviewError(`"${wi.title}" has no pull request yet`);
    const [owner, name] = wi.pr.repo.split("/");
    return { wi, repo: { owner: owner!, name: name! }, number: wi.pr.number };
  }

  private person(userId: string): { forge: PersonForge; login: string } {
    const t = this.k.identities.personToken(userId, "github");
    if (!t) throw new ReviewError("Link your GitHub account to review and merge from Kiln");
    if (!this.k.forge.asPerson) throw new ReviewError(`${this.k.forge.name} does not support reviews from Kiln yet`);
    return { forge: this.k.forge.asPerson(t.token), login: t.login };
  }

  private async call<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/returned 401/.test(msg)) throw new ReviewError("GitHub no longer accepts your linked account's token; link GitHub again");
      if (/returned 403/.test(msg)) throw new ReviewError(`GitHub refused: your account cannot do this on the repository (${msg.slice(0, 200)})`);
      if (/returned 405/.test(msg)) throw new ReviewError("GitHub will not merge this pull request yet: required checks or reviews are missing");
      throw err;
    }
  }
}
