import { authHeaders, KILN_API_URL } from "@/lib/api/raw";

/** Serves uploaded files and run artifacts: proxies GET /api/v1/files/<key> with the server token. */
export async function GET(req: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const { key } = await params;
  const path = key.map(encodeURIComponent).join("/");
  const range = req.headers.get("range");
  const res = await fetch(`${KILN_API_URL}/api/v1/files/${path}`, { headers: authHeaders(range ? { range } : {}), cache: "no-store" });
  if (!res.ok && res.status !== 206) return new Response(res.status === 404 ? "Not found" : "Could not load the file", { status: res.status });
  const headers = new Headers();
  for (const h of ["content-type", "content-length", "content-range", "accept-ranges", "content-disposition", "etag", "last-modified"]) {
    const v = res.headers.get(h);
    if (v) headers.set(h, v);
  }
  headers.set("cache-control", "private, max-age=3600");
  return new Response(res.body, { status: res.status, headers });
}
