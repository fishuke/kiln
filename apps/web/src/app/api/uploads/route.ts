import { API_BASE, apiHeaders } from "@/lib/proxy";

/** Browser uploads go through here so the session token never reaches the client: forwards to POST /api/v1/uploads as the signed-in user. */
export async function POST(req: Request) {
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return Response.json({ error: "missing file" }, { status: 400 });
  const out = new FormData();
  out.set("file", file, file.name);
  try {
    const res = await fetch(`${API_BASE}/api/v1/uploads`, { method: "POST", headers: await apiHeaders(), body: out, cache: "no-store" });
    const text = await res.text();
    if (!res.ok) {
      const msg = res.status === 404 ? "Uploads are not available on this Kiln API yet" : (safeJson(text)?.error ?? `Upload failed (${res.status})`);
      return Response.json({ error: msg }, { status: res.status });
    }
    return new Response(text, { status: 200, headers: { "content-type": "application/json" } });
  } catch {
    return Response.json({ error: "Kiln API is not reachable" }, { status: 502 });
  }
}

function safeJson(text: string): { error?: string } | undefined {
  try {
    return JSON.parse(text) as { error?: string };
  } catch {
    return undefined;
  }
}
