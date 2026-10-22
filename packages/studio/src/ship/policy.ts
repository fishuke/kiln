import type { App, ShipMode } from "../types";
import { PushRefused, type AppRepo, type TeamRole } from "./types";

/** Everything the push guard looks at. */
export type PushContext = {
  app: App;
  repo: AppRepo;
  /** The App policy's `pushDefaultBranch` (AppDefinitions.policy): a team owner or admin opted the imported App in. */
  pushDefaultBranch: boolean;
  /** Any factory names this repository. */
  linkedToFactory: boolean;
};

export const studioBranch = (appId: string) => `studio/${appId}`;

/** The App's main line on the forge: `main` for a template App, the imported branch otherwise. */
export const mainBranchOf = (app: App) => app.setup?.mainBranch ?? "main";

/**
 * ADR-012's exception to ADR-008: the main branch only for (a template App on the repository Kiln
 * created for it) or (an imported App whose policy turns on default-branch pushes), and never on a
 * repository linked to a factory.
 */
function mainPushRefusal(ctx: PushContext): string | undefined {
  const { app, repo } = ctx;
  if (ctx.linkedToFactory) return `${repo.repo} is linked to a factory; Studio pushes only ${studioBranch(app.id)} there`;
  if (app.source.kind === "template") {
    return repo.createdByKiln ? undefined : `${repo.repo} isn't a repository Kiln created for this App`;
  }
  if (ctx.pushDefaultBranch) return undefined;
  return `the App's policy doesn't allow pushes to ${repo.repo}'s default branch, so Studio pushes only ${studioBranch(app.id)}`;
}

/** Where this App's ship mode sends its main line. */
export function pushTarget(ctx: PushContext): string {
  if (ctx.app.shipMode === "cowboy" && !mainPushRefusal(ctx)) return mainBranchOf(ctx.app);
  return studioBranch(ctx.app.id);
}

/** Checked right before every push: the only branches are `studio/<app id>` and the allowed main branch. */
export function assertPushAllowed(ctx: PushContext, branch: string): void {
  const { app, repo } = ctx;
  if (repo.id !== app.id) throw new PushRefused(`the repository record belongs to another App (${repo.id})`);
  if (app.source.kind === "repo" && repo.repo !== app.source.repo) throw new PushRefused(`this App pushes only to ${app.source.repo}`);
  if (branch === studioBranch(app.id)) return;
  if (branch !== mainBranchOf(app)) throw new PushRefused(`Studio pushes only ${studioBranch(app.id)} or ${mainBranchOf(app)}, not ${branch}`);
  if (app.shipMode !== "cowboy") throw new PushRefused(`only cowboy pushes ${branch}; this App ships in ${app.shipMode} mode`);
  const refusal = mainPushRefusal(ctx);
  if (refusal) throw new PushRefused(refusal);
}

const RANK: Record<ShipMode, number> = { safe: 0, review: 1, cowboy: 2 };
export const shipModeAtMost = (mode: ShipMode, cap: ShipMode) => RANK[mode] <= RANK[cap];

/** Team owners and admins: the people who may change an App's policy or cancel anyone's pull request. */
export const isTeamAdmin = (role: TeamRole | undefined) => role === "owner" || role === "admin";
