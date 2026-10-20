import { API_BASE, apiHeaders } from "@/lib/proxy";

/** Serves uploaded files and run artifacts: proxies GET /api/v1/files/<key> as the signed-in user. */
export async function GET(req: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const { key } = await params;
  const path = key.map(encodeURIComponent).join("/");
  const range = req.headers.get("range");
  const res = await fetch(`${API_BASE}/api/v1/files/${path}`, { headers: await apiHeaders(range ? { range } : {}), cache: "no-store" }).catch(() => null);
  if (!res) return new Response("Kiln API is not reachable", { status: 502 });
  if (!res.ok && res.status !== 206) return new Response(res.status === 404 ? "Not found" : "Could not load the file", { status: res.status });
  const headers = new Headers();
  for (const h of ["content-type", "content-length", "content-range", "accept-ranges", "content-disposition", "etag", "last-modified"]) {
    const v = res.headers.get(h);
    if (v) headers.set(h, v);
  }
  headers.set("cache-control", "private, max-age=3600");
  headers.set("x-content-type-options", "nosniff");
  return new Response(res.body, { status: res.status, headers });
}
