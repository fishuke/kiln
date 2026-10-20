import "server-only";
import { KilnApiError } from "@kiln/sdk-ts";
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

const base = () => (process.env.KILN_API_URL ?? "http://localhost:4000").replace(/\/$/, "");

/**
 * Writes definition files of a factory. Uses `POST /api/v1/factories/:id/files:batch` (Kiln-managed
 * factories apply atomically; repo-backed factories get a pull request). Until that endpoint exists it
 * falls back to applying the full modified tree with `POST /api/v1/definitions/apply`.
 */
export async function writeDefinitionFiles(factory: string, changes: FileChange[], message: string): Promise<WriteResult> {
  const res = await fetch(`${base()}/api/v1/factories/${encodeURIComponent(factory)}/files:batch`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json", ...(process.env.KILN_TOKEN ? { authorization: `Bearer ${process.env.KILN_TOKEN}` } : {}) },
    body: JSON.stringify({ changes, message }),
    cache: "no-store",
  }).catch(() => null);
  if (res && res.ok) {
    const data = (await res.json().catch(() => ({}))) as { applied?: string; sha?: string; pullRequest?: string | { url: string } };
    if (data.pullRequest) return { pullRequest: typeof data.pullRequest === "string" ? data.pullRequest : data.pullRequest.url };
    return { applied: data.applied ?? data.sha ?? "" };
  }
  if (res && res.status !== 404 && res.status !== 405 && res.status !== 501) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; errors?: string[] };
    throw new DefinitionWriteError(body.error ?? `Saving failed (${res.status})`, body.errors ?? []);
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
