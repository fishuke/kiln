import { proxyEventStream } from "@/lib/event-stream";
import { API_BASE, apiHeaders } from "@/lib/proxy";

export const dynamic = "force-dynamic";

/** A voice session's events for the browser (client actions, transcript, badges, state): proxies the API's SSE as the signed-in user. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[A-Za-z0-9_-]+$/.test(id)) return new Response(null, { status: 404 });
  return proxyEventStream(`${API_BASE}/api/v1/voice/sessions/${id}/events`, {
    headers: await apiHeaders({ accept: "text/event-stream" }),
    signal: req.signal,
  });
}
