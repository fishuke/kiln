import { z } from "zod";
import { proxyJson } from "@/lib/proxy";

export const dynamic = "force-dynamic";

const Id = z.string().regex(/^[A-Za-z0-9_-]+$/);
const Patch = z
  .object({ focus: z.object({ app: z.string().optional(), chat: z.string().optional() }).strict().optional(), quiet: z.boolean().optional() })
  .strict();

/** The person moved by hand or toggled quiet mode. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = Id.safeParse((await params).id);
  if (!id.success) return new Response(null, { status: 404 });
  const body = Patch.safeParse(await req.json().catch(() => undefined));
  if (!body.success) return Response.json({ error: "Expected { focus?, quiet? }", code: "invalid" }, { status: 400 });
  return proxyJson("PATCH", `/api/v1/voice/sessions/${id.data}`, body.data);
}

/** Ends the voice session. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = Id.safeParse((await params).id);
  if (!id.success) return new Response(null, { status: 404 });
  return proxyJson("DELETE", `/api/v1/voice/sessions/${id.data}`);
}
