import { proxyGet } from "@/lib/proxy";

/** User avatars are stored by the API at this same path; the web serves them with the viewer's session. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return proxyGet(`/api/v1/users/${encodeURIComponent(id)}/avatar`);
}
