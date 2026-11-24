import { proxyEventStream } from "@/lib/event-stream";
import { API_BASE, apiHeaders, proxyJson } from "@/lib/proxy";

export const dynamic = "force-dynamic";

const APP = /^sa_[A-Za-z0-9_-]+$/;

/**
 * An App's Context document for the browser (ADR-019): the API's event stream, proxied as the
 * signed-in user until the browser disconnects. `awareness` is the page's Yjs client id, so the
 * API drops its presence when the stream closes.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!APP.test(id)) return new Response(null, { status: 404 });
  const awareness = new URL(req.url).searchParams.get("awareness") ?? "";
  const query = /^\d+$/.test(awareness) ? `?awareness=${awareness}` : "";
  return proxyEventStream(`${API_BASE}/api/v1/studio/apps/${encodeURIComponent(id)}/context/sync${query}`, {
    headers: await apiHeaders({ accept: "text/event-stream" }),
    signal: req.signal,
  });
}

/** The page's own changes to the document and its presence. The API applies an editor's and refuses a viewer's. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!APP.test(id)) return new Response(null, { status: 404 });
  const body = (await req.json().catch(() => undefined)) as unknown;
  if (!body || typeof body !== "object") return Response.json({ error: "Expected a JSON body" }, { status: 400 });
  return proxyJson("POST", `/api/v1/studio/apps/${encodeURIComponent(id)}/context/sync`, body);
}
