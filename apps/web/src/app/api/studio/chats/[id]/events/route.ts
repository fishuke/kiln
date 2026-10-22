import { API_BASE, apiHeaders } from "@/lib/proxy";

export const dynamic = "force-dynamic";

/** A Studio chat's live events for the browser: proxies the API's SSE stream as the signed-in user. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^sc_[A-Za-z0-9_-]+$/.test(id)) return new Response(null, { status: 404 });
  try {
    const res = await fetch(`${API_BASE}/api/v1/studio/chats/${encodeURIComponent(id)}/events`, {
      headers: await apiHeaders({ accept: "text/event-stream" }),
      cache: "no-store",
      signal: req.signal,
    });
    if (!res.ok || !res.body) return new Response(null, { status: res.status || 502 });
    return new Response(res.body, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive" } });
  } catch {
    return new Response(null, { status: 502 });
  }
}
