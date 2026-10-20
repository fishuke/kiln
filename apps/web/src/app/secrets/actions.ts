"use server";

import { revalidatePath } from "next/cache";
import type { SecretType } from "@kiln/sdk-ts";
import { attempt, type ActionResult } from "@/lib/action-result";
import { api, errorMessage } from "@/lib/kiln";

type Scope = "team" | "personal";

export async function createSecret(input: { scope: Scope; name: string; type: SecretType; value: unknown; description?: string }): Promise<ActionResult> {
  const r = await attempt(() => api.createManagedSecret({ ...input, description: input.description?.trim() || undefined }), `Saved ${input.name}`);
  if (r.ok) revalidatePath("/secrets");
  return r.ok ? { ok: true, message: r.message } : r;
}

export async function updateSecret(scope: Scope, name: string, patch: { value?: unknown; description?: string }): Promise<ActionResult> {
  const r = await attempt(() => api.updateManagedSecret(scope, name, patch), `Saved ${name}`);
  if (r.ok) revalidatePath("/secrets");
  return r.ok ? { ok: true, message: r.message } : r;
}

export async function deleteSecret(scope: Scope, name: string): Promise<ActionResult> {
  const r = await attempt(() => api.deleteManagedSecret(scope, name), `Deleted ${name}`);
  if (r.ok) revalidatePath("/secrets");
  return r.ok ? { ok: true, message: r.message } : r;
}

/** Creates raw secrets from KEY=value pairs; existing names get the new value. */
export async function importSecrets(scope: Scope, pairs: { name: string; value: string }[]): Promise<ActionResult> {
  const existing = new Set((await api.managedSecrets().catch(() => [])).filter((s) => s.scope === scope).map((s) => s.name));
  const failed: string[] = [];
  for (const p of pairs) {
    try {
      if (existing.has(p.name)) await api.updateManagedSecret(scope, p.name, { value: p.value });
      else await api.createManagedSecret({ scope, name: p.name, type: "raw", value: p.value });
    } catch (err) {
      failed.push(`${p.name}: ${errorMessage(err)}`);
    }
  }
  revalidatePath("/secrets");
  if (failed.length === pairs.length) return { ok: false, error: failed.join("; ") };
  return { ok: true, message: `Imported ${pairs.length - failed.length} secret${pairs.length - failed.length === 1 ? "" : "s"}${failed.length ? `; ${failed.length} failed` : ""}` };
}
