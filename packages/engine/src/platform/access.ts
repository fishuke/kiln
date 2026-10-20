import { can, type ApiToken, type TeamRole } from "@kiln/auth";
import type { Kiln } from "../kiln";
import { PlatformError, type Team, type User } from "./types";

/** Who is calling and in which team, with grants computed from memberships at request time. */
export type Access = {
  token: ApiToken;
  user?: User;
  team?: Team;
  teamRole?: TeamRole;
  /** A token with explicit `admin` on every factory (the bootstrap admin, dev auth). */
  superuser: boolean;
  /** Whether listings should be limited to the current team. */
  teamScoped: boolean;
};

/**
 * Resolve the effective access for a verified token. Session and personal tokens carry a user id and
 * get grants from team and factory roles; agent keys act for their team; scoped tokens keep their
 * explicit grants. `teamHeader` (X-Kiln-Team, id or slug) picks the current team; the default is the
 * user's first team.
 */
export function resolveAccess(k: Kiln, token: ApiToken, teamHeader?: string): Access {
  const superuser = can(token, "admin", "*");
  const user = token.userId ? k.users.get(token.userId) : undefined;
  if (token.userId && !user) throw new PlatformError(401, "the user behind this token no longer exists");

  let team: Team | undefined;
  if (teamHeader) {
    team = k.teams.get(teamHeader);
    if (!team) throw new PlatformError(404, `unknown team ${teamHeader}`);
    const allowed = superuser || (user && k.teams.membership(team.id, user.id)) || (token.teamId && token.teamId === team.id) || (!user && !token.teamId);
    if (!allowed) throw new PlatformError(403, `you are not a member of team ${team.slug}`);
  } else if (token.teamId) {
    team = k.teams.get(token.teamId);
  } else if (user) {
    const first = k.teams.teamsOf(user.id)[0];
    team = first ? k.teams.get(first.id) : undefined;
  } else {
    team = k.teams.ensureDefaultTeam();
  }

  let grants = token.grants;
  if (token.type === "session" || token.type === "personal") grants = [...token.grants, ...(user ? k.teams.grantsFor(user.id) : [])];
  else if (token.type === "agent") grants = token.teamId ? k.teams.agentGrants(token.teamId) : [];
  else if (token.type === "worker") grants = [];

  const teamRole = team && user ? k.teams.role(team.id, user.id) : superuser ? "owner" : undefined;
  return { token: { ...token, grants }, user, team, teamRole, superuser, teamScoped: Boolean(user) || Boolean(teamHeader) || token.type === "agent" };
}
