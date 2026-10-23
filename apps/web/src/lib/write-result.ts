import "server-only";
import { DefinitionWriteError, writeDefinitionFiles, type FileChange } from "@/lib/definition-write";
import { errorMessage } from "@/lib/kiln";

/** What a mutating server action hands back to the client for toast feedback. */
export type ActionResult<T = object> = ({ ok: true } & T) | { ok: false; error: string; errors?: string[] };
export type WriteResult = ActionResult<{ applied?: string; pullRequest?: string }>;

export function failure(e: unknown): { ok: false; error: string; errors?: string[] } {
  if (e instanceof DefinitionWriteError) return { ok: false, error: errorMessage(e), errors: e.errors };
  // errorMessage keeps a KilnApiError's message and adds the trace id.
  return { ok: false, error: errorMessage(e) };
}

export async function write(factory: string, changes: FileChange[], message: string): Promise<WriteResult> {
  try {
    return { ok: true, ...(await writeDefinitionFiles(factory, changes, message)) };
  } catch (e) {
    return failure(e);
  }
}
