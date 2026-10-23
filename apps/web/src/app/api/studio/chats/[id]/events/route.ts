import { proxyEventStream } from "@/lib/event-stream";
import { API_BASE, apiHeaders } from "@/lib/proxy";

export const dynamic = "force-dynamic";

/** A Studio chat's live events for the browser: proxies the API's SSE stream as the signed-in user, until the browser disconnects. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^sc_[A-Za-z0-9_-]+$/.test(id)) return new Response(null, { status: 404 });
  return proxyEventStream(`${API_BASE}/api/v1/studio/chats/${encodeURIComponent(id)}/events`, {
    headers: await apiHeaders({ accept: "text/event-stream" }),
    signal: req.signal,
  });
}
