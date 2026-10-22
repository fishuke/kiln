import { z } from "zod";
import { ShipMode, StudioError } from "../types";

/** The team roles in packages/auth, redeclared so Studio doesn't depend on it. */
export const TeamRole = z.enum(["owner", "admin", "member"]);
export type TeamRole = z.infer<typeof TeamRole>;

/** Who asks: a person (with their team role) or `agent:studio` for pushes after a turn. */
export type Actor = { by: string; role?: TeamRole };

/** The highest ship mode each team role may pick on one App (a small check; the roles plan replaces it). */
export const ShipPolicy = z.object({
  id: z.string(), // app id
  caps: z.object({ owner: ShipMode.optional(), admin: ShipMode.optional(), member: ShipMode.optional() }),
  updatedBy: z.string(),
  updatedAt: z.string(),
});
export type ShipPolicy = z.infer<typeof ShipPolicy>;

/** The latest ship mode a person picked for an App, through `Shipper.setShipMode`. */
export const ShipModeChoice = z.object({ id: z.string(), mode: ShipMode, by: z.string(), at: z.string() });
export type ShipModeChoice = z.infer<typeof ShipModeChoice>;

/** The App's forge repository. `createdByKiln` is set only when `Forge.createRepository` made it for this App. */
export const AppRepo = z.object({
  id: z.string(), // app id
  forge: z.string(),
  repo: z.string(), // "owner/name"
  createdByKiln: z.boolean(),
  url: z.string().optional(),
  createdAt: z.string(),
});
export type AppRepo = z.infer<typeof AppRepo>;

export const PullRequestState = z.enum(["uat", "ready_for_review", "merged", "waiting_for_review", "cancelled"]);
export type PullRequestState = z.infer<typeof PullRequestState>;

export const AppPullRequest = z.object({
  id: z.string(), // "sp_…"
  appId: z.string(),
  forge: z.string(),
  repo: z.string(),
  number: z.number().int(),
  url: z.string(),
  branch: z.string(),
  base: z.string(),
  state: PullRequestState,
  versionId: z.string(),
  builtInPreview: z.string().optional(),
  previewUrl: z.string().optional(),
  reasons: z.array(z.string()).optional(),
  createdBy: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type AppPullRequest = z.infer<typeof AppPullRequest>;

/** Store collections for shipping; runtime state only. */
export const SHIP_COLLECTIONS = {
  policies: "studio_ship_policies",
  choices: "studio_ship_choices",
  repos: "studio_repos",
  pullRequests: "studio_pull_requests",
} as const;

/** A push Studio refuses to make (ADR-012's guards). */
export class PushRefused extends StudioError {
  constructor(message: string) {
    super("invalid", message);
    this.name = "PushRefused";
  }
}
