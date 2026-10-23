import { z } from "zod";
import { proxyJson } from "@/lib/proxy";

export const dynamic = "force-dynamic";

const Create = z.object({ sdp: z.string().min(1), app: z.string().optional(), chat: z.string().optional(), resume: z.string().optional() }).strict();

/** Starts (or resumes) a voice session from the browser's WebRTC offer; the API answers with GPT-Live's SDP (docs/specs/107.md). */
export async function POST(req: Request) {
  const parsed = Create.safeParse(await req.json().catch(() => undefined));
  if (!parsed.success) return Response.json({ error: "Expected { sdp, app?, chat?, resume? }", code: "invalid" }, { status: 400 });
  return proxyJson("POST", "/api/v1/voice/sessions", parsed.data);
}
