import "server-only";
import { KilnApiError } from "@kiln/sdk-ts";
import { api } from "@/lib/kiln";

export type DefinitionChange = { path: string; content: string | null };

export class DefinitionWriteError extends Error {
  constructor(
    message: string,
    readonly errors: string[] = [],
  ) {
    super(message);
  }
}

/**
 * Write definition files. Kiln-managed factories apply the change atomically (`applied` is the new
 * sha); repo-backed factories get a pull request (`pullRequest` is its URL). `content: null` deletes.
 * Until the files API exists this falls back to applying the whole modified tree.
 */
export async function writeDefinitionFiles(factory: string, changes: DefinitionChange[], message: string): Promise<{ applied?: string; pullRequest?: string }> {
  try {
    const r = await api.request<{ applied?: string; pullRequest?: string; sha?: string; url?: string }>("POST", `/api/v1/factories/${encodeURIComponent(factory)}/files:batch`, { changes, message });
    return { applied: r.applied ?? r.sha, pullRequest: r.pullRequest ?? r.url };
  } catch (e) {
    // The SDK parses bodies as JSON; a missing route answers with a plain-text 404 (SyntaxError).
    if (!(e instanceof SyntaxError) && !(e instanceof KilnApiError && [404, 405, 501].includes(e.status))) throw asWriteError(e);
  }
  const def = await api.definition(factory);
  const tree = { ...def.tree };
  for (const c of changes) {
    if (c.content === null) delete tree[c.path];
    else tree[c.path] = c.content;
  }
  const r = await api.apply(tree, { factory }).catch((e) => {
    throw asWriteError(e);
  });
  if (!r.ok) throw new DefinitionWriteError(r.errors[0] ?? "The definition is not valid", r.errors);
  return { applied: r.sha };
}

function asWriteError(e: unknown): DefinitionWriteError {
  if (e instanceof DefinitionWriteError) return e;
  if (e instanceof KilnApiError) {
    const errors = ((e.body as { errors?: string[] } | undefined)?.errors ?? []).map(String);
    return new DefinitionWriteError(errors[0] ?? e.message, errors);
  }
  return new DefinitionWriteError(e instanceof Error ? e.message : String(e));
}
