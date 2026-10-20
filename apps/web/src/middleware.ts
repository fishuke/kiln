import { NextResponse, type NextRequest } from "next/server";
import { effectiveToken, isPublicPath, SESSION_COOKIE } from "@/lib/session";

const API = process.env.KILN_API_URL ?? "http://localhost:4000";

/** Whether the API accepts this token (or no token, under dev auth). Cached briefly per token. */
const cache = new Map<string, { ok: boolean; at: number }>();
const TTL_MS = 15_000;

async function authorized(token: string | undefined): Promise<boolean> {
  const key = token ?? "";
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.ok;
  let ok = true;
  try {
    const res = await fetch(`${API.replace(/\/$/, "")}/api/v1/me`, { headers: token ? { authorization: `Bearer ${token}` } : {}, cache: "no-store", signal: AbortSignal.timeout(3000) });
    ok = res.status !== 401;
  } catch {
    // API unreachable: let pages render their own "API is down" state.
    ok = true;
  }
  if (cache.size > 500) cache.clear();
  cache.set(key, { ok, at: Date.now() });
  return ok;
}

export async function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;
  const headers = new Headers(req.headers);
  headers.set("x-kiln-path", path);
  if (!isPublicPath(path)) {
    const session = req.cookies.get(SESSION_COOKIE)?.value;
    if (!(await authorized(effectiveToken(session, process.env.KILN_TOKEN)))) {
      const url = req.nextUrl.clone();
      url.pathname = "/login";
      url.search = "";
      if (path !== "/") url.searchParams.set("next", `${path}${req.nextUrl.search}`);
      const res = NextResponse.redirect(url);
      if (session) res.cookies.delete(SESSION_COOKIE);
      return res;
    }
  }
  return NextResponse.next({ request: { headers } });
}

export const config = {
  // Pages only: skip Next internals, static files, the avatar and file proxies.
  matcher: ["/((?!_next/|favicon.ico|api/|files/|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|txt|xml)$).*)"],
};
