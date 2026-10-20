/** Serves uploaded files (avatars, attachments) by proxying `GET /api/v1/files/<key>` with the server token. */
export async function GET(_req: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const { key } = await params;
  const base = (process.env.KILN_API_URL ?? "http://localhost:4000").replace(/\/$/, "");
  const res = await fetch(`${base}/api/v1/files/${key.map(encodeURIComponent).join("/")}`, {
    headers: process.env.KILN_TOKEN ? { authorization: `Bearer ${process.env.KILN_TOKEN}` } : {},
    cache: "no-store",
  }).catch(() => null);
  if (!res || !res.ok || !res.body) return new Response("Not found", { status: res?.status === 404 || !res ? 404 : res.status });
  const headers = new Headers();
  for (const h of ["content-type", "content-length", "content-disposition", "etag", "last-modified"]) {
    const v = res.headers.get(h);
    if (v) headers.set(h, v);
  }
  headers.set("cache-control", "private, max-age=300");
  headers.set("x-content-type-options", "nosniff");
  return new Response(res.body, { status: 200, headers });
}
