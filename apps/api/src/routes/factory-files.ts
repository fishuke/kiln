import { etagOf, schemaBundle, schemaDocument, schemaIndex, validateFiles } from "@kiln/engine";
import type { Context } from "hono";
import { z } from "zod";
import type { Env, RouteContext } from "../app";
import type { Route } from "../openapi";

export const ValidateFiles = z.object({ files: z.array(z.object({ path: z.string().min(1), content: z.string() })).min(1).max(256) });

export const routes: Route[] = [
  { method: "get", path: "/api/v1/factory-files/schemas", summary: "Published definition schema versions (no token; ETag)", tag: "Definitions" },
  { method: "get", path: "/api/v1/factory-files/schemas/{version}", summary: "Every schema document of a version (no token; ETag)", tag: "Definitions" },
  { method: "get", path: "/api/v1/factory-files/schemas/{version}/{document}", summary: "One schema document, e.g. agent.schema.json (no token; ETag)", tag: "Definitions" },
  { method: "post", path: "/api/v1/factory-files/validate", summary: "Validate files without saving: diagnostics and deferred resolutions (no token; ≤256 files, ≤256 KB each, ≤2 MB)", body: ValidateFiles, tag: "Definitions" },
];

function withEtag(c: Context<Env>, value: unknown) {
  const tag = etagOf(value);
  const match = c.req.header("if-none-match");
  if (match && match.split(",").map((s) => s.trim()).includes(tag)) return c.body(null, 304, { etag: tag });
  return c.json(value, 200, { etag: tag, "cache-control": "public, max-age=300" });
}

/** Definition schemas and validation, open to anyone (editors, CI, coding agents). */
export function register({ app, kiln }: RouteContext) {
  const base = () => kiln.options.publicUrl ?? "http://localhost:4000";
  app.get("/api/v1/factory-files/schemas", (c) => withEtag(c, schemaIndex(base())));
  app.get("/api/v1/factory-files/schemas/:version", (c) => withEtag(c, schemaBundle(c.req.param("version"))));
  app.get("/api/v1/factory-files/schemas/:version/:document", (c) => withEtag(c, schemaDocument(c.req.param("version"), c.req.param("document"))));
  app.post("/api/v1/factory-files/validate", async (c) => {
    const length = Number(c.req.header("content-length") ?? 0);
    if (length > 3 * 1024 * 1024) return c.json({ error: "request larger than 2 MB of files" }, 400);
    const { files } = ValidateFiles.parse(await c.req.json());
    return c.json(validateFiles(files));
  });
}
