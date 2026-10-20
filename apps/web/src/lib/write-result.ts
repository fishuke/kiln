import "server-only";
import { KilnApiError } from "@kiln/sdk-ts";
import { DefinitionWriteError, writeDefinitionFiles, type FileChange } from "@/lib/definition-write";

/** What a mutating server action hands back to the client for toast feedback. */
export type ActionResult<T = object> = ({ ok: true } & T) | { ok: false; error: string; errors?: string[] };
export type WriteResult = ActionResult<{ applied?: string; pullRequest?: string }>;

export function failure(e: unknown): { ok: false; error: string; errors?: string[] } {
  if (e instanceof DefinitionWriteError) return { ok: false, error: e.message, errors: e.errors };
  if (e instanceof KilnApiError) return { ok: false, error: e.message };
  return { ok: false, error: e instanceof Error ? e.message : String(e) };
}

export async function write(factory: string, changes: FileChange[], message: string): Promise<WriteResult> {
  try {
    return { ok: true, ...(await writeDefinitionFiles(factory, changes, message)) };
  } catch (e) {
    return failure(e);
  }
}
