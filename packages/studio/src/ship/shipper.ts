import type { EventBus } from "@kiln/events";
import { RepositoryExistsError, type Forge, type RepoRef } from "@kiln/integrations";
import { shellQuote, type Sandbox } from "@kiln/sandbox";
import type { Store } from "@kiln/store";
import type { Clock, Studio } from "../studio";
import { StudioError, type App, type ShipMode } from "../types";
import { assertPushAllowed, mainBranchOf, maxShipMode, mayEditShipPolicy, pushTarget, shipModeAtMost, type PushContext } from "./policy";
import { SHIP_COLLECTIONS as S, type Actor, type AppRepo, type ShipModeChoice, type ShipPolicy } from "./types";

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
  audit: (actor: string, action: string, target: string, details?: unknown) => void;
};

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

/**
 * Shipping (ADR-012): what reaches an App's forge repository per ship mode. Pushes follow
 * `studio.version_created`; every push passes `assertPushAllowed` and is audited.
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

  policy(appId: string): ShipPolicy | undefined {
    return this.opts.store.get<ShipPolicy>(S.policies, appId);
  }

  choice(appId: string): ShipModeChoice | undefined {
    return this.opts.store.get<ShipModeChoice>(S.choices, appId);
  }

  // ---- policy ----

  /** A person picks the App's ship mode, up to their cap; Studio records who and when. */
  setShipMode(appId: string, mode: ShipMode, actor: Actor): App {
    const app = this.app(appId);
    const cap = maxShipMode(app, this.policy(appId), actor);
    if (!shipModeAtMost(mode, cap)) throw new StudioError("invalid", `${actor.by} may use at most ${cap} on this App`);
    const updated = this.opts.studio.updateApp(appId, { shipMode: mode });
    this.opts.store.put<ShipModeChoice>(S.choices, { id: appId, mode, by: actor.by, at: this.now() });
    this.opts.audit(actor.by, "studio.ship_mode_changed", appId, { from: app.shipMode, to: mode });
    return updated;
  }

  /** Team owners and admins set the highest ship mode per role on one App. */
  setPolicy(appId: string, caps: ShipPolicy["caps"], actor: Actor): ShipPolicy {
    this.app(appId);
    if (!mayEditShipPolicy(actor)) throw new StudioError("invalid", "only team owners and admins change an App's ship policy");
    const policy = this.opts.store.put<ShipPolicy>(S.policies, { id: appId, caps, updatedBy: actor.by, updatedAt: this.now() });
    this.opts.audit(actor.by, "studio.ship_policy_changed", appId, { caps });
    return policy;
  }

  // ---- pushes ----

  /** Push the App's main line where its ship mode sends it (`studio/<app id>` unless the main branch is allowed). */
  async push(appId: string, actor: Actor): Promise<{ repo: AppRepo; branch: string; sha: string }> {
    const app = this.app(appId);
    const forge = this.forgeOf(app);
    const repo = this.repo(appId) ?? (await this.ensureRepo(app, forge, actor));
    const ctx: PushContext = {
      app,
      repo,
      linkedToFactory: this.opts.linkedToFactory(repo.repo),
      ...(this.choice(appId) ? { choice: this.choice(appId)! } : {}),
    };
    return this.pushTo(ctx, forge, pushTarget(ctx), actor);
  }

  /** Push the main line to one branch, after the guard. Runs under the App's Git lock. */
  protected async pushTo(ctx: PushContext, forge: Forge, branch: string, actor: Actor): Promise<{ repo: AppRepo; branch: string; sha: string }> {
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
    this.opts.audit(actor.by, "studio.push", repo.repo, { appId: ctx.app.id, branch, sha, shipMode: ctx.app.shipMode });
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
    let created: Awaited<ReturnType<NonNullable<Forge["createRepository"]>>>;
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

  /** After a new version: `review` and `cowboy` push; `safe` waits for `ship`. */
  protected async afterVersion(appId: string): Promise<void> {
    const app = this.app(appId);
    if (app.shipMode === "safe") return;
    await this.push(appId, { by: STUDIO_AGENT });
  }

  /** Run pushes for one App in order. A failed push after a turn is in the audit log. */
  protected enqueue(appId: string, fn: () => Promise<void>) {
    const prev = this.queues.get(appId) ?? Promise.resolve();
    const next = prev.then(fn).catch((err: unknown) => {
      this.opts.audit(STUDIO_AGENT, "studio.push_failed", appId, { error: err instanceof Error ? err.message : String(err) });
    });
    this.queues.set(appId, next);
  }

  // ---- plumbing ----

  protected forgeOf(app: App): Forge {
    const forge = this.opts.forge(app);
    if (!forge) throw new StudioError("unavailable", "this App has no forge connection");
    return forge;
  }

  protected app(appId: string): App {
    const found = this.opts.studio.getApp(appId);
    if (!found) throw new StudioError("not_found", `unknown app ${appId}`);
    return found.app;
  }

  protected now() {
    return this.opts.clock.now().toISOString();
  }
}

/** A trusted git command; its error never carries the push credential. */
async function gitOut(sandbox: Sandbox, command: string, secret: string | undefined, env?: Record<string, string>): Promise<string> {
  const r = await sandbox.exec(command, { cwd: "app", trusted: true, ...(env ? { env } : {}) });
  if (r.code === 0) return r.stdout.trim();
  const text = (r.stderr || r.stdout).trim();
  throw new StudioError("unavailable", `${command.split(" ", 2).join(" ")} failed: ${secret ? text.replaceAll(secret, "***") : text}`);
}
