import { proxyGet } from "@/lib/proxy";

/** Team avatars are stored by the API at this same path; the web serves them with the viewer's session. */
export async function GET(_req: Request, { params }: { params: Promise<{ team: string }> }) {
  const { team } = await params;
  return proxyGet(`/api/v1/teams/${encodeURIComponent(team)}/avatar`);
}
