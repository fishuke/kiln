"use server";

import { revalidatePath } from "next/cache";
import type { EnvironmentInput } from "@kiln/sdk-ts";
import { attempt, type ActionResult } from "@/lib/action-result";
import { api } from "@/lib/kiln";

export async function saveEnvironment(id: string | undefined, input: EnvironmentInput): Promise<ActionResult<{ id: string }>> {
  const clean: EnvironmentInput = {
    name: input.name.trim(),
    description: input.description?.trim() || undefined,
    image: input.image?.trim() || undefined,
    repos: input.repos ?? [],
    setupCommands: (input.setupCommands ?? []).map((c) => c.trim()).filter(Boolean),
    secrets: input.secrets ?? [],
  };
  const r = await attempt(() => (id ? api.updateEnvironment(id, clean) : api.createEnvironment(clean)), `Saved ${clean.name}`);
  if (!r.ok) return r;
  revalidatePath("/environments");
  return { ok: true, message: r.message, data: { id: r.data!.id } };
}

export async function deleteEnvironment(id: string, name: string): Promise<ActionResult> {
  const r = await attempt(() => api.deleteEnvironment(id), `Deleted ${name}`);
  if (r.ok) revalidatePath("/environments");
  return r.ok ? { ok: true, message: r.message } : r;
}
