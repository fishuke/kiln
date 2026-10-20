"use server";

import { revalidatePath } from "next/cache";
import { api } from "@/lib/kiln";
import { failure, write, type ActionResult, type WriteResult } from "@/lib/write-result";

/** Validate a full definition tree without applying it. */
export async function validateTree(tree: Record<string, string>): Promise<ActionResult<{ errors: string[]; warnings: string[] }>> {
  try {
    const r = await api.validate(tree);
    return { ok: true, errors: r.errors ?? [], warnings: r.warnings ?? [] };
  } catch (e) {
    // The validate endpoint answers 400 with the errors in the body.
    const body = (e as { body?: { errors?: string[]; warnings?: string[] } }).body;
    if (body?.errors) return { ok: true, errors: body.errors, warnings: body.warnings ?? [] };
    return failure(e);
  }
}

/** Commit every changed file with one message (managed) or open a pull request (repo-backed). */
export async function saveDefinition(factory: string, changes: { path: string; content: string | null }[], message: string): Promise<WriteResult> {
  if (!changes.length) return { ok: false, error: "Nothing to save." };
  const r = await write(factory, changes, message.trim() || "Update factory definition");
  revalidatePath(`/f/${factory}`, "layout");
  return r;
}
