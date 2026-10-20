import { api, errorMessage } from "@/lib/kiln";

const CHOICES = new Set(["light", "dark", "system"]);

/** Saves the account's appearance preference (PATCH /api/v1/me) from the account menu. Best effort. */
export async function POST(req: Request) {
  let appearance: unknown;
  try {
    appearance = ((await req.json()) as { appearance?: unknown }).appearance;
  } catch {
    return Response.json({ error: "send { appearance }" }, { status: 400 });
  }
  if (typeof appearance !== "string" || !CHOICES.has(appearance)) return Response.json({ error: "appearance is light, dark or system" }, { status: 400 });
  try {
    await api.updateMe({ appearance: appearance as "light" | "dark" | "system" });
    return new Response(null, { status: 204 });
  } catch (err) {
    return Response.json({ error: errorMessage(err) }, { status: 502 });
  }
}
