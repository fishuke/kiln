import { isTeamAdmin, type TeamRole } from "@kiln/auth";
import type { Team } from "@kiln/engine";
import type { Context } from "hono";
import { HttpError, type Env, type RouteContext } from "../app";

export const AVATAR_MAX_BYTES = 1024 * 1024;

/**
 * The team named in the path (id or slug) and the caller's role in it. Superusers (the bootstrap
 * admin, dev auth) count as owners. `min` is the least role the route needs.
 */
export function teamFor(ctx: RouteContext, c: Context<Env>, idOrSlug: string, min: "member" | "admin" | "owner" = "member"): { team: Team; role: TeamRole } {
  const a = ctx.access(c);
  const team = ctx.kiln.teams.get(idOrSlug);
  const role: TeamRole | undefined = team && a.user ? (ctx.kiln.teams.role(team.id, a.user.id) ?? (a.superuser ? "owner" : undefined)) : a.superuser ? "owner" : undefined;
  if (!team || !role) throw new HttpError(404, `unknown team ${idOrSlug}`);
  if (min === "admin" && !isTeamAdmin(role)) throw new HttpError(403, "team owners and admins only");
  if (min === "owner" && role !== "owner") throw new HttpError(403, "team owners only");
  return { team, role };
}

/** The current team with the caller's role, for team-wide pages (secrets, MCPs, environments, usage). */
export function currentTeam(ctx: RouteContext, c: Context<Env>, min: "member" | "admin" = "member") {
  return teamFor(ctx, c, ctx.team(c).id, min);
}

export function actor(ctx: RouteContext, c: Context<Env>) {
  const a = ctx.access(c);
  return { userId: a.user?.id, label: ctx.who(c), superuser: a.superuser };
}

/** An uploaded image: raw body with an image content type, at most 1 MiB. */
export async function readImage(c: Context<Env>): Promise<{ bytes: Uint8Array; contentType: string }> {
  const contentType = c.req.header("content-type") ?? "";
  if (!/^image\/(png|jpeg|gif|webp|svg\+xml)$/.test(contentType)) throw new HttpError(400, "upload a PNG, JPEG, GIF, WebP or SVG image");
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  if (bytes.length === 0) throw new HttpError(400, "the upload is empty");
  if (bytes.length > AVATAR_MAX_BYTES) throw new HttpError(413, "avatars are limited to 1 MiB");
  return { bytes, contentType };
}

export async function serveObject(ctx: RouteContext, key: string | undefined, contentType = "application/octet-stream") {
  const bytes = key ? await ctx.kiln.objects.get(key) : undefined;
  if (!bytes) throw new HttpError(404, "no avatar");
  return new Response(bytes, { headers: { "content-type": contentType, "cache-control": "private, max-age=300" } });
}
