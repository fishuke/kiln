import "server-only";
import { KilnApiError } from "@kiln/sdk-ts";
import { isMissingEndpoint } from "@/lib/api/missing";
import { api } from "@/lib/kiln";

export type FileChange = { path: string; content: string | null };
export type WriteResult = { applied: string; pullRequest?: undefined } | { pullRequest: string; applied?: undefined };

export class DefinitionWriteError extends Error {
  constructor(
    message: string,
    readonly errors: string[] = [],
  ) {
    super(message);
  }
}

/**
 * Writes definition files of a factory. Uses `POST /api/v1/factories/:id/files:batch` (Kiln-managed
 * factories apply atomically; repo-backed factories get a pull request). Servers without that
 * endpoint get the full modified tree through `POST /api/v1/definitions/apply`.
 */
export async function writeDefinitionFiles(factory: string, changes: FileChange[], message: string): Promise<WriteResult> {
  try {
    const data = await api.request<{ applied?: string; sha?: string; pullRequest?: string | { url: string } }>("POST", `/api/v1/factories/${encodeURIComponent(factory)}/files:batch`, { changes, message });
    if (data.pullRequest) return { pullRequest: typeof data.pullRequest === "string" ? data.pullRequest : data.pullRequest.url };
    return { applied: data.applied ?? data.sha ?? "" };
  } catch (e) {
    if (e instanceof KilnApiError && !isMissingEndpoint(e)) {
      const body = e.body as { error?: string; errors?: string[] } | undefined;
      throw new DefinitionWriteError(body?.error ?? `Saving failed (${e.status})`, body?.errors ?? []);
    }
  }
  return applyTree(factory, changes);
}

async function applyTree(factory: string, changes: FileChange[]): Promise<WriteResult> {
  const current = await api.definition(factory).catch(() => ({ tree: {} as Record<string, string> }));
  const tree = { ...current.tree };
  for (const c of changes) {
    if (c.content === null) {
      for (const k of Object.keys(tree)) if (k === c.path || k.startsWith(`${c.path.replace(/\/$/, "")}/`)) delete tree[k];
    } else tree[c.path] = c.content;
  }
  try {
    const r = await api.apply(tree, { factory });
    if (!r.ok) throw new DefinitionWriteError(r.errors[0] ?? "The definition is not valid", r.errors);
    return { applied: r.sha };
  } catch (e) {
    if (e instanceof DefinitionWriteError) throw e;
    if (e instanceof KilnApiError) {
      const body = e.body as { errors?: string[]; error?: string } | undefined;
      throw new DefinitionWriteError(body?.errors?.[0] ?? body?.error ?? e.message, body?.errors ?? []);
    }
    throw new DefinitionWriteError(e instanceof Error ? e.message : String(e));
  }
}

/** Reads one file of the applied definition (undefined when missing). */
export async function readDefinitionFile(factory: string, path: string): Promise<string | undefined> {
  const d = await api.definition(factory).catch(() => null);
  return d?.tree[path];
}

/** Server-action friendly result: never throws, carries the PR link or the validation errors. */
export type SaveResult = { ok: true; applied?: string; pullRequest?: string } | { ok: false; error: string; errors?: string[] };

export async function saveFiles(factory: string, changes: FileChange[], message: string): Promise<SaveResult> {
  try {
    const r = await writeDefinitionFiles(factory, changes, message);
    return { ok: true, applied: r.applied, pullRequest: r.pullRequest };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), errors: e instanceof DefinitionWriteError ? e.errors : undefined };
  }
}
