import { randomBytes } from "node:crypto";
import type { EventBus } from "@kiln/events";
import { RepositoryExistsError, type Forge, type PreviewProvider, type RepoRef } from "@kiln/integrations";
import { shellQuote, type Sandbox } from "@kiln/sandbox";
import type { Store } from "@kiln/store";
import type { Clock, Studio } from "../studio";
import { StudioError, type App, type ShipMode } from "../types";
import { maxShipMode, type AppPolicySummary } from "../app-definitions";
import type { MergeGateOutcome, StudioMergeGate } from "./merge-gate";
import { assertPushAllowed, isTeamAdmin, mainBranchOf, pushTarget, shipModeAtMost, studioBranch, type PushContext } from "./policy";
import { SHIP_COLLECTIONS as S, type Actor, type AppPullRequest, type AppRepo, type PullRequestState, type ShipModeChoice } from "./types";

/** Who pushes after a turn: Studio on the agent's behalf (ADR-012: every agent push is audited). */
export const STUDIO_AGENT = "agent:studio";

export type ShipperOptions = {
  studio: Studio;
  store: Store;
  bus: EventBus;
  clock: Clock;
  /** The App's forge connection; undefined when the server has none for it. */
  forge: (app: App) => Forge | undefined;
  /** Where a template App's repository is created; without it a template App can't be pushed. */
  newRepo?: (app: App) => { owner: string } | undefined;
  /** Whether any factory names this repository ("owner/name"). */
  linkedToFactory: (repo: string) => boolean;
  /** The App's resolved policy, the only source of ship caps and default-branch pushes: `(app) => appDefinitions.policy(targetOf(app))`. */
  policyOf: (app: App) => AppPolicySummary;
  /** ADR-014: decides, when the author marks a pull request ready for review, whether a person reviews it. */
  mergeGate: StudioMergeGate;
  /** The pull request's deployment preview, when one is configured. */
  previews?: PreviewProvider;
  /** Studio's own preview of a version, recorded on the pull request. */
  versionPreviewUrl?: (app: App, versionId: string) => string;
  audit: (actor: string, action: string, target: string, details?: unknown) => void;
};

export type ShipInput = { title?: string; state?: "uat" | "ready_for_review" | "cancelled" };

const OPEN: readonly PullRequestState[] = ["uat", "ready_for_review", "waiting_for_review"];

const toRef = (repo: string, forge?: string): RepoRef => {
  const [owner, name] = repo.split("/") as [string, string];
  return { owner, name, ...(forge === "github" ? { forge } : {}) };
};

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "app";

const isPerson = (by: string) => by !== "studio" && !by.startsWith("agent:");

/**
 * Shipping (ADR-012): what reaches an App's forge repository per ship mode, and the App's pull
 * request. Pushes follow `studio.version_created`; every push passes `assertPushAllowed` and is audited.
 */
export class Shipper {
  private readonly queues = new Map<string, Promise<void>>();

  constructor(private readonly opts: ShipperOptions) {}

  /** Follow new versions on the bus; returns the unsubscribe function. */
  start(): () => void {
    return this.opts.bus.subscribe("studio.version_created", (e) => {
      if (e.payload.kind !== "initial") this.enqueue(e.payload.appId, () => this.afterVersion(e.payload.appId));
    });
  }

  /** Resolves when the App's queued pushes are done. */
  async idle(appId: string): Promise<void> {
    for (let q = this.queues.get(appId); q; q = this.queues.get(appId)) {
      await q;
      if (this.queues.get(appId) === q) return;
    }
  }

  // ---- reads ----

  repo(appId: string): AppRepo | undefined {
    return this.opts.store.get<AppRepo>(S.repos, appId);
  }

  choice(appId: string): ShipModeChoice | undefined {
    return this.opts.store.get<ShipModeChoice>(S.choices, appId);
  }

  /** The App's open pull request (uat, ready for review or waiting for review). */
  pullRequest(appId: string): AppPullRequest | undefined {
    return this.opts.store.list<AppPullRequest>(S.pullRequests, (p) => p.appId === appId && OPEN.includes(p.state))[0];
  }

  /** Every pull request of the App, newest first. */
  pullRequests(appId: string): AppPullRequest[] {
    return this.opts.store.list<AppPullRequest>(S.pullRequests, (p) => p.appId === appId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  // ---- ship mode ----

  /** A person picks the App's ship mode, up to the cap the App policy gives their role; Studio records who, their role and when. */
  setShipMode(appId: string, mode: ShipMode, actor: Actor): App {
    const app = this.app(appId);
    if (!isPerson(actor.by)) throw new StudioError("invalid", "only a person picks an App's ship mode");
    const cap = maxShipMode(this.opts.policyOf(app), actor.role);
    if (!shipModeAtMost(mode, cap)) throw new StudioError("invalid", `${actor.by} may use at most ${cap} on this App`);
    const updated = this.opts.studio.updateApp(appId, { shipMode: mode });
    this.opts.store.put<ShipModeChoice>(S.choices, { id: appId, mode, by: actor.by, ...(actor.role ? { role: actor.role } : {}), at: this.now() });
    this.opts.audit(actor.by, "studio.ship_mode_changed", appId, { from: app.shipMode, to: mode });
    return updated;
  }

  // ---- pushes ----

  /** Push the App's main line where its ship mode sends it (`studio/<app id>` unless the main branch is allowed). */
  async push(appId: string, actor: Actor): Promise<{ repo: AppRepo; branch: string; sha: string }> {
    const { ctx, forge } = await this.context(appId, actor);
    return this.pushTo(ctx, forge, pushTarget(ctx), actor);
  }

  private async context(appId: string, actor: Actor): Promise<{ ctx: PushContext; forge: Forge }> {
    const app = this.app(appId);
    const forge = this.forgeOf(app);
    const repo = this.repo(appId) ?? (await this.ensureRepo(app, forge, actor));
    const pushDefaultBranch = this.opts.policyOf(app).pushDefaultBranch;
    return { ctx: { app, repo, pushDefaultBranch, linkedToFactory: this.opts.linkedToFactory(repo.repo) }, forge };
  }

  /** Push the main line to one branch, after the guard, under the App's Git lock. */
  private async pushTo(ctx: PushContext, forge: Forge, branch: string, actor: Actor): Promise<{ repo: AppRepo; branch: string; sha: string }> {
    const { repo } = ctx;
    try {
      assertPushAllowed(ctx, branch);
    } catch (err) {
      this.opts.audit(actor.by, "studio.push_refused", repo.repo, { appId: ctx.app.id, branch, reason: (err as Error).message });
      throw err;
    }
    const ref = toRef(repo.repo, repo.forge);
    const sha = await this.opts.studio.withWorkspace(ctx.app.id, async (sandbox, app) => {
      const main = mainBranchOf(app);
      // A fresh credential scoped to this one repository, only in this command's environment.
      const token = await forge.sandboxToken?.(ref);
      const url = forge.cloneUrl(ref, token);
      const head = await gitOut(sandbox, `git rev-parse ${shellQuote(main)}`, token);
      await gitOut(sandbox, `git -c credential.helper= push --porcelain "$KILN_PUSH_URL" ${shellQuote(`${main}:refs/heads/${branch}`)}`, token, {
        KILN_PUSH_URL: url,
        GIT_TERMINAL_PROMPT: "0",
      });
      return head;
    });
    const optIn = branch !== studioBranch(ctx.app.id) && ctx.app.source.kind === "repo" ? this.opts.policyOf(ctx.app).changedBy.pushDefaultBranch : undefined;
    this.opts.audit(actor.by, "studio.push", repo.repo, {
      appId: ctx.app.id,
      branch,
      sha,
      shipMode: ctx.app.shipMode,
      ...(optIn ? { optedInBy: optIn.by, optedInAt: optIn.at } : {}),
    });
    return { repo, branch, sha };
  }

  /** A template App's repository is created on its first push; an imported App's is the one it came from. */
  private async ensureRepo(app: App, forge: Forge, actor: Actor): Promise<AppRepo> {
    if (app.source.kind === "repo") {
      return this.opts.store.put<AppRepo>(S.repos, { id: app.id, forge: forge.name, repo: app.source.repo, createdByKiln: false, createdAt: this.now() });
    }
    const where = this.opts.newRepo?.(app);
    if (!where || !forge.createRepository) throw new StudioError("unavailable", "this server can't create repositories for template Apps");
    const name = `${slug(app.name)}-${app.id.slice(3, 9)}`;
    let created: { repo: RepoRef; url: string };
    try {
      created = await forge.createRepository({ owner: where.owner, name, private: true, description: `Kiln Studio App ${app.name}` });
    } catch (err) {
      if (err instanceof RepositoryExistsError)
        throw new StudioError("conflict", `${err.repo} already exists; Studio creates a new repository for a template App`);
      throw err;
    }
    const full = `${created.repo.owner}/${created.repo.name}`;
    const repo = this.opts.store.put<AppRepo>(S.repos, {
      id: app.id,
      forge: forge.name,
      repo: full,
      createdByKiln: true,
      url: created.url,
      createdAt: this.now(),
    });
    this.opts.audit(actor.by, "studio.repo_created", full, { appId: app.id });
    return repo;
  }

  /** After a new version: `review` and `cowboy` push; `safe` waits for `ship`. A studio-branch push keeps the open pull request current. */
  private async afterVersion(appId: string): Promise<void> {
    const app = this.app(appId);
    if (app.shipMode === "safe") return;
    const { branch } = await this.push(appId, { by: STUDIO_AGENT });
    if (branch === studioBranch(appId) && (app.shipMode === "review" || this.pullRequest(appId)))
      await this.syncPullRequest(this.app(appId), this.authorOfLatest(app));
  }

  /** Run pushes for one App in order. A failed push after a turn is in the audit log. */
  private enqueue(appId: string, fn: () => Promise<void>) {
    const prev = this.queues.get(appId) ?? Promise.resolve();
    const next = prev.then(fn).catch((err: unknown) => {
      this.opts.audit(STUDIO_AGENT, "studio.push_failed", appId, { error: err instanceof Error ? err.message : String(err) });
    });
    this.queues.set(appId, next);
  }

  // ---- the App's pull request ----

  /**
   * The `ship` tool: no state (or `uat`) pushes `studio/<app id>` and opens or updates the pull
   * request; `ready_for_review` (the author only) asks the merge gate; `cancelled` closes it.
   */
  async ship(appId: string, input: ShipInput, actor: Actor): Promise<AppPullRequest> {
    if (!input.state || input.state === "uat") {
      await this.idle(appId);
      const { ctx, forge } = await this.context(appId, actor);
      await this.pushTo(ctx, forge, studioBranch(appId), actor);
      return this.syncPullRequest(this.app(appId), this.pullRequest(appId)?.createdBy ?? actor.by, input.title);
    }
    const pr = this.pullRequest(appId);
    if (!pr) throw new StudioError("not_found", "this App has no open pull request; ship it first");
    return input.state === "ready_for_review" ? this.readyForReview(pr, actor) : this.cancel(pr, actor);
  }

  /**
   * `merge_gate.review_updated` (a person merged later, or the review closed): record it on the
   * pull request. The gate's event is the notification, so this publishes nothing.
   */
  reviewUpdated(input: {
    pullRequestId?: string;
    repo: string;
    number: number;
    state: "deciding" | "merged" | "needs_review" | "closed";
  }): AppPullRequest | undefined {
    const pr = this.opts.store.list<AppPullRequest>(
      S.pullRequests,
      (p) => (input.pullRequestId ? p.id === input.pullRequestId : p.repo === input.repo && p.number === input.number) && OPEN.includes(p.state),
    )[0];
    const state = ({ merged: "merged", closed: "cancelled", needs_review: "waiting_for_review", deciding: undefined } as const)[input.state];
    if (!pr || !state || pr.state === state) return pr;
    return this.record(pr, state, "merge-gate");
  }

  /** A person merged the pull request on the forge (its webhook). */
  forgeMerged(repo: string, number: number): AppPullRequest | undefined {
    const pr = this.opts.store.list<AppPullRequest>(S.pullRequests, (p) => p.repo === repo && p.number === number && OPEN.includes(p.state))[0];
    return pr ? this.transition(pr, "merged", "forge") : undefined;
  }

  private async syncPullRequest(app: App, author: string, title?: string): Promise<AppPullRequest> {
    const forge = this.forgeOf(app);
    const repo = this.repo(app.id)!;
    const ref = toRef(repo.repo, repo.forge);
    const version = this.opts.studio.getApp(app.id)!.versions[0]!;
    const branch = studioBranch(app.id);
    let pr = this.pullRequest(app.id);
    if (pr) {
      if (title) await forge.updatePullRequest(ref, pr.number, { title });
      if (pr.state !== "uat") {
        // New changes after the author was done: back to testing, and the reviewers' item goes away until they're ready again.
        this.opts.mergeGate.pullRequestClosed({ repo: pr.repo, number: pr.number, merged: false });
        pr = this.transition(pr, "uat", STUDIO_AGENT);
      }
    } else {
      const opened = await forge.openPullRequest({
        repo: ref,
        head: branch,
        base: mainBranchOf(app),
        title: title ?? version.title,
        body: `Shipped from Kiln Studio App ${app.name}.`,
      });
      const now = this.now();
      pr = this.opts.store.put<AppPullRequest>(S.pullRequests, {
        id: `spr_${randomBytes(16).toString("hex")}`,
        appId: app.id,
        forge: repo.forge,
        repo: repo.repo,
        number: opened.number,
        url: opened.url,
        branch,
        base: opened.base,
        state: "uat",
        versionId: version.id,
        createdBy: author,
        createdAt: now,
        updatedAt: now,
      });
      this.opts.audit(author, "studio.pull_request_opened", `${repo.repo}#${opened.number}`, { appId: app.id, pullRequestId: pr.id });
      this.publish(pr);
    }
    const deployment = await this.opts.previews?.deploy({ repo: repo.repo, branch, pr: pr.number });
    const builtIn = this.opts.versionPreviewUrl?.(app, version.id);
    return this.opts.store.put<AppPullRequest>(S.pullRequests, {
      ...pr,
      versionId: version.id,
      ...(builtIn ? { builtInPreview: builtIn } : {}),
      ...(deployment ? { previewUrl: deployment.url } : {}),
      updatedAt: this.now(),
    });
  }

  private async readyForReview(pr: AppPullRequest, actor: Actor): Promise<AppPullRequest> {
    if (!isPerson(actor.by)) throw new StudioError("invalid", "only a person marks a pull request ready for review");
    if (actor.by !== pr.createdBy) throw new StudioError("invalid", `only the author (${pr.createdBy}) marks it ready for review`);
    if (pr.state !== "uat") throw new StudioError("conflict", `the pull request is already ${pr.state}`);
    const ready = this.transition(pr, "ready_for_review", actor.by);
    const app = this.app(pr.appId);
    const outcome = await this.opts.mergeGate.readyForReview({
      scope: { kind: "app", appId: app.id, team: app.team },
      repo: pr.repo,
      number: pr.number,
      by: actor.by,
      pullRequestId: pr.id,
      ...(ready.previewUrl ? { preview: { url: ready.previewUrl, status: "ready" as const } } : {}),
    });
    return this.applyGate(ready, outcome);
  }

  private async cancel(pr: AppPullRequest, actor: Actor): Promise<AppPullRequest> {
    if (!isPerson(actor.by) || (actor.by !== pr.createdBy && !isTeamAdmin(actor.role)))
      throw new StudioError("invalid", "only the author or a team admin cancels a pull request");
    const forge = this.forgeOf(this.app(pr.appId));
    if (!forge.closePullRequest) throw new StudioError("unavailable", `the ${forge.name} forge can't close pull requests`);
    await forge.closePullRequest(toRef(pr.repo, pr.forge), pr.number);
    if (pr.state !== "uat") this.opts.mergeGate.pullRequestClosed({ repo: pr.repo, number: pr.number, merged: false, by: actor.by });
    return this.transition(pr, "cancelled", actor.by);
  }

  /** The merge gate's answer. The gate adds the Inbox item and raises the needs-you event, so this publishes nothing. */
  private applyGate(pr: AppPullRequest, result: MergeGateOutcome): AppPullRequest {
    return result.outcome === "merged" ? this.record(pr, "merged", "merge-gate") : this.record(pr, "waiting_for_review", "merge-gate", result.reasons);
  }

  /** Store and audit a state change without an event. */
  private record(pr: AppPullRequest, state: PullRequestState, by: string, reviewReasons?: string[]): AppPullRequest {
    const { reviewReasons: _, ...rest } = pr;
    const next = this.opts.store.put<AppPullRequest>(S.pullRequests, { ...rest, state, ...(reviewReasons ? { reviewReasons } : {}), updatedAt: this.now() });
    this.opts.audit(by, `studio.pull_request_${state}`, `${pr.repo}#${pr.number}`, {
      appId: pr.appId,
      pullRequestId: pr.id,
      ...(reviewReasons ? { reviewReasons } : {}),
    });
    return next;
  }

  /** A state change ship makes itself: stored, audited and published. */
  private transition(pr: AppPullRequest, state: PullRequestState, by: string): AppPullRequest {
    const next = this.record(pr, state, by);
    this.publish(next);
    return next;
  }

  private publish(pr: AppPullRequest) {
    this.opts.bus.publish("studio.pull_request_state_changed", { appId: pr.appId, pullRequestId: pr.id, state: pr.state, url: pr.url, priority: "finished" });
  }

  /** The person whose turn made the newest version, else the App's creator. */
  private authorOfLatest(app: App): string {
    const chatId = this.opts.studio.getApp(app.id)!.versions[0]?.chatId;
    const turns = chatId ? (this.opts.studio.getChat(chatId)?.turns ?? []) : [];
    return (
      turns
        .map((t) => t.by)
        .filter(isPerson)
        .at(-1) ?? app.createdBy
    );
  }

  // ---- plumbing ----

  private forgeOf(app: App): Forge {
    const forge = this.opts.forge(app);
    if (!forge) throw new StudioError("unavailable", "this App has no forge connection");
    return forge;
  }

  private app(appId: string): App {
    const found = this.opts.studio.getApp(appId);
    if (!found) throw new StudioError("not_found", `unknown app ${appId}`);
    return found.app;
  }

  private now() {
    return this.opts.clock.now().toISOString();
  }
}

/** A trusted git command in the App's main repository; its error never carries the push credential. */
async function gitOut(sandbox: Sandbox, command: string, secret: string | undefined, env?: Record<string, string>): Promise<string> {
  const r = await sandbox.exec(command, { cwd: "app", trusted: true, ...(env ? { env } : {}) });
  if (r.code === 0) return r.stdout.trim();
  const text = (r.stderr || r.stdout).trim();
  throw new StudioError("unavailable", `${command.split(" ", 2).join(" ")} failed: ${secret ? text.replaceAll(secret, "***") : text}`);
}
