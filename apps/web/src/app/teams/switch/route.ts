import { NextResponse, type NextRequest } from "next/server";
import { isSecureRequest, safeNext, TEAM_COOKIE, teamCookieOptions, validTeam } from "@/lib/session";

/** /teams/switch?team=<id or slug>: remembers the team (sent as X-Kiln-Team) and goes back. */
export async function GET(req: NextRequest) {
  const team = validTeam(req.nextUrl.searchParams.get("team"));
  let back = safeNext(req.nextUrl.searchParams.get("next"), "");
  if (!back) {
    const ref = req.headers.get("referer");
    try {
      const u = ref ? new URL(ref) : undefined;
      back = u && u.host === req.nextUrl.host ? safeNext(`${u.pathname}${u.search}`) : "/";
    } catch {
      back = "/";
    }
  }
  // Factory pages belong to the old team; land on the home page instead.
  if (back.startsWith("/f/")) back = "/";
  const url = req.nextUrl.clone();
  const [path, query = ""] = back.split("?");
  url.pathname = path!;
  url.search = query ? `?${query}` : "";
  const res = NextResponse.redirect(url);
  if (team) res.cookies.set(TEAM_COOKIE, team, teamCookieOptions(isSecureRequest(req.url, req.headers.get("x-forwarded-proto"))));
  return res;
}
