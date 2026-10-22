import { BUILTIN_DECISIONS, runDecision, type Answers, type DecisionOutcome } from "@kiln/decide";
import { GateMergeConflict, type GateMerger, type RepoRef } from "@kiln/integrations";
import type { Decision } from "@kiln/schema";
import { z } from "zod";
import type { InboxItem } from "./inbox";
import type { Kiln } from "./kiln";
import { newId } from "./types";

export const MergeGateScope = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("app"), appId: z.string().min(1), team: z.string().min(1) }),
  z.object({ kind: z.literal("factory"), factory: z.string().min(1) }),
]);
export type MergeGateScope = z.infer<typeof MergeGateScope>;

export const ReadyForReview = z.object({
  scope: MergeGateScope,
  repo: z.string().regex(/^[^/\s]+\/[^/\s]+$/, 'use "owner/name"'),
  number: z.number().int().positive(),
  /** The person who marked the pull request ready for review. */
  by: z.string().min(1),
  areas: z.array(z.string().max(200)).max(50).optional(),
  tests: z.enum(["passed", "failed", "none"]).optional(),
  preview: z.object({ url: z.string().url().optional(), status: z.enum(["ready", "failed", "none"]) }).optional(),
  findings: z
    .array(z.object({ severity: z.enum(["low", "medium", "high"]), text: z.string().max(2000) }))
    .max(100)
    .optional(),
  link: z.string().url().optional(),
  pullRequestId: z.string().optional(),
});
export type ReadyForReview = z.infer<typeof ReadyForReview>;

export type MergeReviewState = "deciding" | "merged" | "needs_review" | "closed";

export type MergeReview = {
  id: string;
  scope: MergeGateScope;
  repo: string;
  number: number;
  url: string;
  title: string;
  author: string;
  by: string;
  headSha: string;
  state: MergeReviewState;
  reasons: string[];
  decision?: { logId: string; action: string; answers: Answers; provider: string; fellBack: boolean };
  mergedBy?: string;
  previewUrl?: string;
  link?: string;
  pullRequestId?: string;
  createdAt: string;
  updatedAt: string;
  decidedAt?: string;
};

export type MergeGateSetting = { id: string; appId: string; team: string; enabled: boolean; updatedBy: string; updatedAt: string };

export class MergeGateError extends Error {
  constructor(
    readonly code: "not_found" | "invalid",
    message: string,
  ) {
    super(message);
    this.name = "MergeGateError";
  }
}

const REVIEWS = "merge_reviews";
const SETTINGS = "merge_gate_settings";
const DIFF_LIMIT = 20_000;
const GATE_OFF = "The merge gate is off, so a person reviews every pull request.";
const NO_CREDENTIAL = "This server has no merge credential for the gate (KILN_MERGE_GATE_TOKEN).";

const label = (name: string) => {
  const s = name.replace(/[-_]+/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
};

/** Plain sentences for the Inbox and Studio: what the decision saw that matters, then its answers. */
function reasonsFor(state: Record<string, unknown>, outcome: DecisionOutcome): string[] {
  if (Object.keys(outcome.answers).length === 0) return [`The merge-safety decision could not answer: ${outcome.error ?? "no provider answered"}.`];
  const reasons: string[] = [];
  if (state.checks === "failure") reasons.push("CI failed.");
  if (state.checks === "pending") reasons.push("CI is still running.");
  if (state.checks === "none") reasons.push("No CI checks ran.");
  if (state.tests === "failed") reasons.push("Tests failed.");
  if (state.preview === "failed") reasons.push("The preview failed.");
  for (const [name, answer] of Object.entries(outcome.answers)) {
    if (typeof answer === "number") reasons.push(`${label(name)}: ${answer.toFixed(2)}.`);
    else {
      const [option, p] = Object.entries(answer).sort((a, b) => b[1] - a[1])[0] ?? [];
      if (option !== undefined) reasons.push(`${label(name)}: ${option} (${p!.toFixed(2)}).`);
    }
  }
  return reasons;
}

/**
 * The merge gate (ADR-014): when a person marks a pull request ready for review, the
 * `merge-safety` decision judges it, and the gate merges it or sends it to a person. The merge
 * capability is held here and nowhere else.
 */
export class MergeGateService {
  readonly #merger: GateMerger | undefined;
  readonly #inflight = new Map<string, Promise<MergeReview>>();

  constructor(
    private readonly k: Kiln,
    merger: GateMerger | undefined,
  ) {
    this.#merger = merger;
  }

  enabled(scope: MergeGateScope): boolean {
    if (scope.kind === "app") return this.k.store.get<MergeGateSetting>(SETTINGS, `app:${scope.appId}`)?.enabled ?? false;
    const binding = this.k.defs.get(scope.factory);
    if (!binding) throw new MergeGateError("not_found", `unknown factory ${scope.factory}`);
    if (!binding.appliedSha) return false;
    const values = Object.values(this.k.defs.current(scope.factory).parsed.policies).map((p) => p.mergeGate);
    return values.includes(true) && !values.includes(false);
  }

  setAppEnabled(input: { appId: string; team: string; enabled: boolean; by: string }): MergeGateSetting {
    const setting: MergeGateSetting = {
      id: `app:${input.appId}`,
      appId: input.appId,
      team: input.team,
      enabled: input.enabled,
      updatedBy: input.by,
      updatedAt: this.k.clock.now().toISOString(),
    };
    this.k.store.put(SETTINGS, setting);
    this.k.audit(input.by, input.enabled ? "merge_gate.enabled" : "merge_gate.disabled", setting.id, { team: input.team, appId: input.appId });
    return setting;
  }

  get(id: string): MergeReview | undefined {
    return this.k.store.get<MergeReview>(REVIEWS, id);
  }

  list(filter: { team?: string; factory?: string; state?: MergeReviewState[] }): MergeReview[] {
    return this.k.store
      .list<MergeReview>(
        REVIEWS,
        (r) =>
          (!filter.team || (r.scope.kind === "app" && r.scope.team === filter.team)) &&
          (!filter.factory || (r.scope.kind === "factory" && r.scope.factory === filter.factory)) &&
          (!filter.state || filter.state.includes(r.state)),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /** Judge a pull request a person marked ready for review: merge it, or send it to a person. */
  async readyForReview(raw: ReadyForReview): Promise<MergeReview> {
    const input = ReadyForReview.parse(raw);
    const key = `${input.repo}#${input.number}`;
    const running = this.#inflight.get(key);
    if (running) return running;
    const work = this.decide(input).finally(() => this.#inflight.delete(key));
    this.#inflight.set(key, work);
    return work;
  }

  private async decide(input: ReadyForReview): Promise<MergeReview> {
    const [owner, name] = input.repo.split("/") as [string, string];
    const ref: RepoRef = { owner, name };
    const pr = await this.k.forge.getPullRequest(ref, input.number);
    if (!pr) throw new MergeGateError("not_found", `pull request ${input.repo}#${input.number} was not found`);
    if (pr.state !== "open") throw new MergeGateError("invalid", `pull request ${input.repo}#${input.number} is ${pr.state}`);
    if (pr.draft) throw new MergeGateError("invalid", `pull request ${input.repo}#${input.number} is a draft; mark it ready for review first`);
    const headSha = pr.headSha ?? "";
    const existing = this.k.store.list<MergeReview>(
      REVIEWS,
      (r) => r.repo === input.repo && r.number === input.number && r.headSha === headSha && r.state !== "closed",
    )[0];
    if (existing) return existing;

    const now = this.k.clock.now().toISOString();
    let review: MergeReview = {
      id: newId("mrv"),
      scope: input.scope,
      repo: input.repo,
      number: input.number,
      url: pr.url,
      title: pr.title,
      author: pr.author,
      by: input.by,
      headSha,
      state: "deciding",
      reasons: [],
      ...(input.preview?.url ? { previewUrl: input.preview.url } : {}),
      ...(input.link ? { link: input.link } : {}),
      ...(input.pullRequestId ? { pullRequestId: input.pullRequestId } : {}),
      createdAt: now,
      updatedAt: now,
    };
    this.k.store.put(REVIEWS, review);

    if (!this.enabled(input.scope)) {
      review = this.finish(review, { state: "needs_review", reasons: [GATE_OFF] });
      this.audit("kiln", "merge_gate.sent_to_review", review, { reasons: review.reasons });
      return review;
    }

    let state: Record<string, unknown>;
    try {
      state = await this.decisionState(ref, input, pr.title, pr.author, headSha);
    } catch (err) {
      // Without the diff or CI the gate cannot judge it; a person reviews it instead (fail closed).
      const message = err instanceof Error ? err.message : String(err);
      review = this.finish(review, { state: "needs_review", reasons: [`Kiln could not read the pull request to judge it: ${message}.`] });
      this.audit("kiln", "merge_gate.sent_to_review", review, { reasons: review.reasons, error: message });
      return review;
    }
    const outcome = await runDecision("merge-safety", this.definition(input.scope), state, this.k.decide);
    const log = this.k.logDecision(outcome, state);
    const decision = { logId: log.id, action: outcome.action, answers: outcome.answers, provider: outcome.provider, fellBack: outcome.fellBack };
    const details = {
      decisionLogId: log.id,
      decision: "merge-safety",
      state,
      answers: outcome.answers,
      action: outcome.action,
      provider: outcome.provider,
      fellBack: outcome.fellBack,
    };

    if (outcome.action !== "merge") {
      review = this.finish(review, { state: "needs_review", decision, reasons: reasonsFor(state, outcome) });
      this.audit("kiln", "merge_gate.sent_to_review", review, { ...details, reasons: review.reasons });
      return review;
    }
    if (!this.#merger) {
      review = this.finish(review, { state: "needs_review", decision, reasons: [NO_CREDENTIAL] });
      this.audit("kiln", "merge_gate.sent_to_review", review, { ...details, reasons: review.reasons });
      return review;
    }
    try {
      const merged = await this.#merger.merge({ repo: ref, number: input.number, expectedHeadSha: headSha, title: pr.title });
      review = this.finish(review, { state: "merged", decision, mergedBy: merged.mergedBy ?? this.#merger.identity });
      this.audit(this.#merger.identity, "merge_gate.merged", review, details);
      return review;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const reason = err instanceof GateMergeConflict ? `The gate did not merge it: ${message}.` : `The gate could not merge it: ${message}.`;
      review = this.finish(review, { state: "needs_review", decision, reasons: [reason] });
      this.audit("kiln", "merge_gate.merge_failed", review, { ...details, error: message });
      return review;
    }
  }

  /** The forge reports the pull request merged or closed: a person's later merge, a webhook, or Studio's cancel. */
  pullRequestClosed(input: { repo: string; number: number; merged: boolean; by?: string }): MergeReview[] {
    return this.k.store
      .list<MergeReview>(REVIEWS, (r) => r.repo === input.repo && r.number === input.number && r.state === "needs_review")
      .map((r) => this.finish(r, input.merged ? { state: "merged", ...(input.by ? { mergedBy: input.by } : {}) } : { state: "closed" }));
  }

  /** Inbox items for pull requests the gate did not merge. */
  inboxItems(): InboxItem[] {
    return this.list({ state: ["needs_review"] }).map((r) => ({
      id: `merge:${r.id}`,
      kind: r.scope.kind === "app" ? "studio_pr_review" : "pr_review",
      ...(r.scope.kind === "factory" ? { factory: r.scope.factory } : { team: r.scope.team, appId: r.scope.appId }),
      title: `Review: ${r.title}`,
      description: r.reasons.join("\n"),
      reasons: r.reasons,
      url: r.link ?? r.url,
      urls: [r.url, ...(r.previewUrl ? [r.previewUrl] : [])],
      artifacts: [],
      mergeReviewId: r.id,
      actions: ["view"],
      recipients: this.reviewers(r.scope),
      urgency: 0.5,
      createdAt: r.decidedAt ?? r.createdAt,
    }));
  }

  private reviewers(scope: MergeGateScope): string[] {
    if (scope.kind === "factory") return this.k.options.roles?.admins ?? [];
    return this.k.teams
      .members(scope.team)
      .filter((m) => m.role === "owner" || m.role === "admin")
      .flatMap((m) => this.k.users.get(m.userId)?.email ?? []);
  }

  private definition(scope: MergeGateScope): Decision {
    const builtin = BUILTIN_DECISIONS["merge-safety"]!;
    if (scope.kind === "app") return builtin;
    return this.k.defs.current(scope.factory).parsed.decisions["merge-safety"] ?? builtin;
  }

  /** What the decision sees: the diff, the areas it touches, CI, tests, preview, findings and the author. */
  private async decisionState(ref: RepoRef, input: ReadyForReview, title: string, author: string, headSha: string): Promise<Record<string, unknown>> {
    if (!this.k.forge.pullRequestFiles) throw new Error(`the ${this.k.forge.name} forge cannot list a pull request's files`);
    const files = await this.k.forge.pullRequestFiles(ref, input.number);
    const checks = await this.k.forge.checks(ref, headSha);
    const paths = files.map((f) => f.path);
    return {
      title,
      author,
      files: paths,
      areas: input.areas ?? [...new Set(paths.map((p) => p.split("/").slice(0, 2).join("/")))],
      additions: files.reduce((n, f) => n + f.additions, 0),
      deletions: files.reduce((n, f) => n + f.deletions, 0),
      diff: files
        .map((f) => `--- ${f.path}\n${f.patch ?? ""}`)
        .join("\n")
        .slice(0, DIFF_LIMIT),
      checks: checks.runs.length === 0 ? "none" : checks.status,
      tests: input.tests ?? "none",
      preview: input.preview?.status ?? "none",
      findings: (input.findings ?? []).map((f) => `${f.severity}: ${f.text}`),
    };
  }

  private finish(review: MergeReview, patch: Partial<MergeReview> & { state: MergeReviewState }): MergeReview {
    const now = this.k.clock.now().toISOString();
    const next: MergeReview = { ...review, ...patch, updatedAt: now, ...(review.state === "deciding" ? { decidedAt: now } : {}) };
    this.k.store.put(REVIEWS, next);
    this.k.bus.publish("merge_gate.review_updated", {
      reviewId: next.id,
      ...(next.scope.kind === "app" ? { appId: next.scope.appId } : { factory: next.scope.factory }),
      ...(next.pullRequestId ? { pullRequestId: next.pullRequestId } : {}),
      repo: next.repo,
      number: next.number,
      state: next.state,
      priority: next.state === "needs_review" ? "needs_you" : "finished",
    });
    return next;
  }

  private audit(actor: string, action: string, review: MergeReview, details: Record<string, unknown>) {
    const scope = review.scope.kind === "app" ? { team: review.scope.team, appId: review.scope.appId } : { factory: review.scope.factory };
    this.k.audit(actor, action, review.id, { ...scope, repo: review.repo, number: review.number, headSha: review.headSha, readyBy: review.by, ...details });
  }
}
