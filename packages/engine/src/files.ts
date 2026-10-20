import { KilnError } from "./errors";
import type { Kiln } from "./kiln";
import { mediaOf } from "./media";
import { C, newId, type Attachment, type Run, type Upload } from "./types";

export const UPLOAD_LIMITS = { maxFileBytes: 25 * 1024 * 1024, maxFiles: 25 } as const;

/** Keep the name readable but safe as one path segment. */
export function safeName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "file";
  const clean = base.replace(/[^A-Za-z0-9._ -]+/g, "_").replace(/^\.+/, "").trim().slice(0, 120);
  return clean || "file";
}

/**
 * Uploaded files (attachments on tasks, messages and follow-ups) and the files runs produce.
 * Bytes live in the object store; uploads are recorded so access can be checked by owner.
 */
export class FileService {
  constructor(private readonly k: Kiln) {}

  async upload(input: { name: string; contentType?: string; bytes: Uint8Array; uploader: string; factory?: string }): Promise<Attachment> {
    if (input.bytes.byteLength > UPLOAD_LIMITS.maxFileBytes) throw new KilnError("invalid_request", `${input.name} is larger than 25 MB`);
    const id = newId("upl");
    const name = safeName(input.name);
    const key = `uploads/${id}/${name}`;
    const contentType = input.contentType && input.contentType !== "application/octet-stream" ? input.contentType : mediaOf(name).contentType;
    await this.k.objects.put(key, input.bytes, contentType);
    const rec: Upload = { id, key, name, contentType, size: input.bytes.byteLength, uploader: input.uploader, factory: input.factory, createdAt: this.k.clock.now().toISOString() };
    this.k.store.put(C.uploads, rec);
    this.k.audit(input.uploader, "file.uploaded", key, { size: rec.size, factory: input.factory });
    return { key, name, contentType, size: rec.size };
  }

  uploadFor(key: string): Upload | undefined {
    const m = /^uploads\/([^/]+)\//.exec(key);
    return m ? this.k.store.get<Upload>(C.uploads, m[1]!) : undefined;
  }

  /** The factory that owns a stored object, when one does. */
  ownerFactory(key: string): string | undefined {
    const up = this.uploadFor(key);
    if (up) return up.factory ?? this.attachedFactory(key);
    const run = /^runs\/([^/]+)\//.exec(key);
    if (run) return this.k.store.get<Run>(C.runs, run[1]!)?.factory;
    const evidence = /^evidence\/([^/]+)\//.exec(key);
    if (evidence) return this.k.workflow.get(evidence[1]!)?.factory;
    const avatar = /^avatars\/([^/]+)\//.exec(key);
    if (avatar) return avatar[1];
    return undefined;
  }

  /** An upload without a factory belongs to the factory of the first task that attached it. */
  private attachedFactory(key: string): string | undefined {
    return this.k.workflow.list().find((w) => w.attachments?.some((a) => a.key === key))?.factory;
  }

  /** Check every attachment exists and that `by` may use it (they uploaded it, or it belongs to the factory). */
  resolveAttachments(keys: (string | { key: string })[], by: string, factory: string): Attachment[] {
    if (keys.length > UPLOAD_LIMITS.maxFiles) throw new KilnError("invalid_request", `at most ${UPLOAD_LIMITS.maxFiles} attachments`);
    return keys.map((k) => {
      const key = typeof k === "string" ? k : k.key;
      const up = this.uploadFor(key);
      if (!up) throw new KilnError("resource_not_found", `unknown attachment ${key}`);
      if (up.uploader !== by && up.factory !== factory) throw new KilnError("not_authorized", `attachment ${key} belongs to someone else`);
      if (!up.factory) this.k.store.put(C.uploads, { ...up, factory });
      return { key: up.key, name: up.name, contentType: up.contentType, size: up.size };
    });
  }

  async read(key: string): Promise<{ bytes: Uint8Array; contentType: string; name: string } | undefined> {
    if (key.includes("..")) return undefined;
    const bytes = await this.k.objects.get(key);
    if (!bytes) return undefined;
    const up = this.uploadFor(key);
    const name = key.split("/").pop() ?? "file";
    const run = /^runs\/([^/]+)\//.exec(key);
    const artifact = run ? this.k.store.get<Run>(C.runs, run[1]!)?.artifacts.find((a) => a.key === key) : undefined;
    return { bytes, name, contentType: up?.contentType ?? artifact?.contentType ?? mediaOf(name).contentType };
  }
}
