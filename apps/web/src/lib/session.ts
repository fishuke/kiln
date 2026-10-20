/** Web session helpers. Pure functions so they run in middleware, route handlers and tests. */

export const SESSION_COOKIE = "kiln_session";
export const TEAM_COOKIE = "kiln_team";
/** Sessions last 30 days on the API; the cookie never outlives that. */
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30;
export const TEAM_MAX_AGE = 60 * 60 * 24 * 365;

export type CookieOptions = { httpOnly: boolean; sameSite: "lax"; secure: boolean; path: string; maxAge: number; expires?: Date };

/** Cookie options for the session token: httpOnly, SameSite=Lax, Secure on https. */
export function sessionCookieOptions(opts: { secure: boolean; expiresAt?: string; now?: number }): CookieOptions {
  const now = opts.now ?? Date.now();
  let maxAge = SESSION_MAX_AGE;
  if (opts.expiresAt) {
    const left = Math.floor((Date.parse(opts.expiresAt) - now) / 1000);
    if (Number.isFinite(left)) maxAge = Math.max(0, Math.min(SESSION_MAX_AGE, left));
  }
  return { httpOnly: true, sameSite: "lax", secure: opts.secure, path: "/", maxAge };
}

export function teamCookieOptions(secure: boolean): CookieOptions {
  return { httpOnly: true, sameSite: "lax", secure, path: "/", maxAge: TEAM_MAX_AGE };
}

/** True when the request reached us over https (directly or behind a proxy). */
export function isSecureRequest(url: string, forwardedProto?: string | null): boolean {
  if (forwardedProto) return forwardedProto.split(",")[0]!.trim() === "https";
  return url.startsWith("https:");
}

/** Pages that work without a session. */
const PUBLIC_PREFIXES = ["/login", "/signup", "/invite", "/join", "/auth", "/logout", "/docs"];

export function isPublicPath(path: string): boolean {
  return PUBLIC_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
}

/** Auth pages render without the app shell. */
export function isAuthPage(path: string): boolean {
  return ["/login", "/signup", "/invite", "/join", "/auth"].some((p) => path === p || path.startsWith(`${p}/`));
}

/** Only same-site relative paths are allowed as a post-login destination (no open redirects). */
export function safeNext(next: string | null | undefined, fallback = "/"): string {
  if (!next) return fallback;
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  if (isAuthPage(next) || next.startsWith("/logout")) return fallback;
  return next;
}

/** Reads `#token=...` that the API's GitHub callback appends to the redirect URL. */
export function tokenFromFragment(hash: string): string | undefined {
  const h = hash.startsWith("#") ? hash.slice(1) : hash;
  const v = new URLSearchParams(h).get("token");
  return v && v.trim() ? v.trim() : undefined;
}

/** The token a server-side request should use: the signed-in session first, then the server token. */
export function effectiveToken(sessionToken: string | undefined, serverToken: string | undefined): string | undefined {
  return sessionToken?.trim() || serverToken?.trim() || undefined;
}

/** Team ids and slugs are short identifiers; anything else is ignored. */
export function validTeam(team: string | null | undefined): string | undefined {
  if (!team) return undefined;
  return /^[A-Za-z0-9_-]{1,64}$/.test(team) ? team : undefined;
}
