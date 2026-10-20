import { NextResponse, type NextRequest } from "next/server";
import { KilnClient } from "@kiln/sdk-ts";
import { KILN_API_URL } from "@/lib/kiln";
import { safeNext, SESSION_COOKIE, TEAM_COOKIE } from "@/lib/session";

/** Revokes the session on the API, clears the cookies and goes to /login. */
export async function GET(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (token) await new KilnClient({ baseUrl: KILN_API_URL, token }).logout().catch(() => undefined);
  const url = req.nextUrl.clone();
  const next = safeNext(req.nextUrl.searchParams.get("next"), "");
  url.pathname = "/login";
  url.search = next ? `?next=${encodeURIComponent(next)}` : "";
  const res = NextResponse.redirect(url);
  res.cookies.delete(SESSION_COOKIE);
  res.cookies.delete(TEAM_COOKIE);
  return res;
}
