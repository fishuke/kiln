import { can } from "@kiln/auth";
import { UPLOAD_LIMITS } from "@kiln/engine";
import type { RouteContext } from "../app";
import { HttpError } from "../app";
import type { Route } from "../openapi";
import { restOf } from "./util";

export const routes: Route[] = [
  { method: "post", path: "/api/v1/uploads", summary: "Upload files (multipart, up to 25 files of 25 MB): {key, name, contentType, size} of the first plus `attachments`", scope: "send", tag: "Files" },
  { method: "get", path: "/api/v1/files/{key}", summary: "Download a stored file (uploads, run artifacts, evidence) with its content type; supports Range", scope: "read", tag: "Files" },
];

/** Uploads and file downloads. */
export function register({ app, kiln, need, who }: RouteContext) {
  app.post("/api/v1/uploads", async (c) => {
    const length = Number(c.req.header("content-length") ?? 0);
    if (length > UPLOAD_LIMITS.maxFiles * UPLOAD_LIMITS.maxFileBytes + 1_000_000) throw new HttpError(400, "upload too large");
    const form = await c.req.parseBody({ all: true });
    const factory = typeof form.factory === "string" ? form.factory : c.get("run")?.factory;
    if (factory) need(c, "send", factory);
    const files = Object.entries(form)
      .filter(([k]) => k !== "factory")
      .flatMap(([, v]) => (Array.isArray(v) ? v : [v]))
      .filter((v): v is File => typeof v === "object" && v !== null && "arrayBuffer" in v);
    if (!files.length) throw new HttpError(400, "send files as multipart form fields (file or files)");
    if (files.length > UPLOAD_LIMITS.maxFiles) throw new HttpError(400, `at most ${UPLOAD_LIMITS.maxFiles} files per upload`);
    for (const f of files) if (f.size > UPLOAD_LIMITS.maxFileBytes) throw new HttpError(400, `${f.name} is larger than 25 MB`);
    const attachments = [];
    for (const f of files) attachments.push(await kiln.files.upload({ name: f.name, contentType: f.type, bytes: new Uint8Array(await f.arrayBuffer()), uploader: who(c), factory }));
    // One file: the attachment itself ({key, name, contentType, size}); always also the list.
    return c.json({ ...attachments[0]!, attachments }, 201);
  });

  app.get("/api/v1/files/*", async (c) => {
    const key = restOf(c, /^\/api\/v1\/files\//);
    if (!key || key.includes("..")) throw new HttpError(400, "invalid file key");
    const up = kiln.files.uploadFor(key);
    const factory = kiln.files.ownerFactory(key);
    const token = c.get("token");
    const run = c.get("run");
    const allowed = up?.uploader === who(c) || (factory ? (run ? run.factory === factory : can(token, "read", factory)) : can(token, "admin", "*"));
    if (!allowed) throw new HttpError(403, "you cannot read this file");
    const file = await kiln.files.read(key);
    if (!file) throw new HttpError(404, "unknown file");
    const total = file.bytes.byteLength;
    // Range requests let browsers seek in recordings.
    const range = /^bytes=(\d*)-(\d*)$/.exec(c.req.header("range") ?? "");
    let body = file.bytes;
    let status = 200;
    const extra: Record<string, string> = { "accept-ranges": "bytes" };
    if (range && (range[1] || range[2])) {
      const start = range[1] ? Number(range[1]) : Math.max(0, total - Number(range[2]));
      const end = range[1] && range[2] ? Math.min(Number(range[2]), total - 1) : total - 1;
      if (start >= total || start > end) return new Response(null, { status: 416, headers: { "content-range": `bytes */${total}` } });
      body = file.bytes.subarray(start, end + 1);
      status = 206;
      extra["content-range"] = `bytes ${start}-${end}/${total}`;
    }
    return new Response(body, {
      status,
      headers: {
        ...extra,
        "content-type": file.contentType,
        "content-length": String(body.byteLength),
        "content-disposition": `${/^(image|video)\//.test(file.contentType) ? "inline" : "attachment"}; filename="${file.name.replace(/"/g, "")}"`,
        "cache-control": "private, max-age=300",
        "x-content-type-options": "nosniff",
        "content-security-policy": "sandbox; default-src 'none'; img-src 'self'; media-src 'self'",
      },
    });
  });
}
