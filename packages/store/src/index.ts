import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";

/** Runtime state lives here; definitions live in Git. Collections hold documents with an `id`. */
export interface Store {
  get<T extends { id: string }>(collection: string, id: string): T | undefined;
  put<T extends { id: string }>(collection: string, doc: T): T;
  delete(collection: string, id: string): boolean;
  list<T extends { id: string }>(collection: string, filter?: (doc: T) => boolean): T[];
  /** Run several writes together; on error none of them are kept. */
  transaction<R>(fn: (store: Store) => R): R;
}

type Data = Record<string, Record<string, unknown>>;

export class MemoryStore implements Store {
  protected data: Data = {};

  get<T extends { id: string }>(collection: string, id: string): T | undefined {
    const doc = this.data[collection]?.[id];
    return doc === undefined ? undefined : (structuredClone(doc) as T);
  }

  put<T extends { id: string }>(collection: string, doc: T): T {
    (this.data[collection] ??= {})[doc.id] = structuredClone(doc);
    this.persist();
    return doc;
  }

  delete(collection: string, id: string): boolean {
    const existed = Boolean(this.data[collection]?.[id]);
    if (existed) delete this.data[collection]![id];
    this.persist();
    return existed;
  }

  list<T extends { id: string }>(collection: string, filter?: (doc: T) => boolean): T[] {
    const docs = Object.values(this.data[collection] ?? {}).map((d) => structuredClone(d) as T);
    return filter ? docs.filter(filter) : docs;
  }

  transaction<R>(fn: (store: Store) => R): R {
    const snapshot = structuredClone(this.data);
    const persist = this.persist;
    this.persist = () => {};
    try {
      const result = fn(this);
      this.persist = persist;
      this.persist();
      return result;
    } catch (err) {
      this.data = snapshot;
      this.persist = persist;
      throw err;
    }
  }

  protected persist(): void {}
}

/** A MemoryStore that writes a JSON file after each change. Good for a single-node dev install. */
export class FileStore extends MemoryStore {
  constructor(private readonly path: string) {
    super();
    if (existsSync(path)) this.data = JSON.parse(readFileSync(path, "utf8")) as Data;
  }

  protected override persist(): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data));
    renameSync(tmp, this.path);
  }
}

/** Object storage for videos, traces, logs and snapshots (S3/MinIO in production). */
export interface ObjectStore {
  put(key: string, body: Uint8Array | string, contentType?: string): Promise<{ key: string; url: string }>;
  get(key: string): Promise<Uint8Array | undefined>;
  list(prefix: string): Promise<string[]>;
}

export class MemoryObjectStore implements ObjectStore {
  readonly objects = new Map<string, { body: Uint8Array; contentType?: string }>();

  async put(key: string, body: Uint8Array | string, contentType?: string) {
    this.objects.set(key, { body: typeof body === "string" ? new TextEncoder().encode(body) : body, contentType });
    return { key, url: `memory://${key}` };
  }

  async get(key: string) {
    return this.objects.get(key)?.body;
  }

  async list(prefix: string) {
    return [...this.objects.keys()].filter((k) => k.startsWith(prefix)).sort();
  }
}

export class FileObjectStore implements ObjectStore {
  constructor(private readonly root: string) {}

  async put(key: string, body: Uint8Array | string) {
    const path = `${this.root}/${key}`;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, body);
    return { key, url: `file://${path}` };
  }

  async get(key: string) {
    const path = `${this.root}/${key}`;
    return existsSync(path) ? new Uint8Array(readFileSync(path)) : undefined;
  }

  async list(prefix: string) {
    const { readdirSync, statSync } = await import("node:fs");
    const out: string[] = [];
    const walk = (dir: string, rel: string) => {
      if (!existsSync(dir)) return;
      for (const e of readdirSync(dir)) {
        const full = `${dir}/${e}`;
        const key = rel ? `${rel}/${e}` : e;
        if (statSync(full).isDirectory()) walk(full, key);
        else if (key.startsWith(prefix)) out.push(key);
      }
    };
    walk(this.root, "");
    return out.sort();
  }
}
