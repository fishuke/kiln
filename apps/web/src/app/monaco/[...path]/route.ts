import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Serves the Monaco editor's AMD build from node_modules so the definition editor works on
 * self-hosted installs without a CDN. Falls back to the pinned CDN copy when the files are absent.
 */
const VERSION = "0.57.0";
const TYPES: Record<string, string> = { ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".ttf": "font/ttf", ".json": "application/json", ".svg": "image/svg+xml" };

const roots = () => [path.join(process.cwd(), "node_modules/monaco-editor/min"), path.join(process.cwd(), "apps/web/node_modules/monaco-editor/min")];

export async function GET(_req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const parts = (await params).path;
  if (!parts.length || parts.some((p) => p === ".." || p.includes("\0") || p.startsWith("."))) return new Response("Not found", { status: 404 });
  const rel = parts.join("/");
  const type = TYPES[path.extname(rel)];
  if (!type) return new Response("Not found", { status: 404 });
  for (const root of roots()) {
    const file = path.join(root, rel);
    if (!file.startsWith(root + path.sep)) continue;
    try {
      const body = await readFile(file);
      return new Response(new Uint8Array(body), { headers: { "content-type": type, "cache-control": "public, max-age=31536000, immutable" } });
    } catch {
      /* try the next root */
    }
  }
  return Response.redirect(`https://cdn.jsdelivr.net/npm/monaco-editor@${VERSION}/min/${rel}`, 302);
}
