import { proxyEventStream } from "@/lib/event-stream";
import { API_BASE, apiHeaders } from "@/lib/proxy";

export const dynamic = "force-dynamic";

/** Live run events for the browser: proxies the API's SSE stream as the signed-in user, until the browser disconnects. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const after = new URL(req.url).searchParams.get("after") ?? "0";
  return proxyEventStream(`${API_BASE}/api/v1/runs/${encodeURIComponent(id)}/stream?after=${encodeURIComponent(after)}`, {
    headers: await apiHeaders({ accept: "text/event-stream" }),
    signal: req.signal,
  });
}
