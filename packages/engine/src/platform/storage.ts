import { isAbsolute, join, relative, resolve } from "node:path";
import { FileObjectStore, S3ObjectStore, type ObjectStore } from "@kiln/store";
import type { Kiln } from "../kiln";
import { C, newId } from "../types";
import { PlatformError, type StorageTarget } from "./types";

export const STORAGE_CATEGORIES = ["artifacts", "transcripts", "attachments"] as const;
export type StorageCategory = (typeof STORAGE_CATEGORIES)[number];

/** Where a routed object went, so reads find it even after the team changes its settings. */
type Location = { id: string; team: string; category: StorageCategory; target: StorageTarget };

const LOCATIONS = "object_locations";

/**
 * The object store Kiln uses everywhere. Keys tell it the category and team:
 * `runs/<runId>/…` are artifacts, `transcripts/<runId>…` transcripts, and
 * `attachments/<teamId>/…` attachments. Each goes to the team's configured storage (a local folder
 * under the server's storage root, or an S3-compatible bucket); everything else, and teams that keep
 * the default, use the server's object store.
 */
export class StorageRouter implements ObjectStore {
  constructor(
    private readonly k: Kiln,
    readonly base: ObjectStore,
  ) {}

  /** A key for an uploaded attachment that routes to the team's attachment storage. */
  attachmentKey(teamId: string, name: string): string {
    return `attachments/${teamId}/${newId("att")}/${name.replace(/[^\w.-]+/g, "_")}`;
  }

  route(key: string): { team: string; category: StorageCategory } | undefined {
    const [head, second] = key.split("/");
    if (head === "runs" || head === "transcripts") {
      const runId = (second ?? "").replace(/\.jsonl?$/, "");
      const run = this.k.store.get<{ id: string; factory: string; team?: string }>(C.runs, runId);
      const team = run ? (run.team ?? this.k.teams.factoryTeam(run.factory)) : undefined;
      return team ? { team, category: head === "runs" ? "artifacts" : "transcripts" } : undefined;
    }
    if (head === "attachments" && second?.startsWith("team_") && this.k.teams.get(second)) return { team: second, category: "attachments" };
    return undefined;
  }

  /** The store for a target; undefined means the server's default store. */
  storeFor(team: string, target: StorageTarget): ObjectStore | undefined {
    if (target.kind === "local") {
      if (!target.path) return undefined;
      return new FileObjectStore(this.localPath(target.path));
    }
    const secrets = this.k.vault.resolver({ teamId: team });
    const credentials = () => {
      const accessKeyId = target.accessKeyIdSecret ? secrets.get(target.accessKeyIdSecret) : process.env.AWS_ACCESS_KEY_ID;
      const secretAccessKey = target.secretAccessKeySecret ? secrets.get(target.secretAccessKeySecret) : process.env.AWS_SECRET_ACCESS_KEY;
      if (!accessKeyId || !secretAccessKey) throw new PlatformError(400, `no credentials for bucket ${target.bucket}: set the team secrets named in storage settings`);
      return { accessKeyId, secretAccessKey, sessionToken: target.accessKeyIdSecret ? undefined : process.env.AWS_SESSION_TOKEN };
    };
    return new S3ObjectStore({ bucket: target.bucket, region: target.region, endpoint: target.endpoint, prefix: target.prefix, forcePathStyle: target.forcePathStyle, credentials });
  }

  /** Team folders live under the server's storage root; a path cannot leave it. */
  localPath(path: string): string {
    const root = resolve(this.k.options.storageRoot ?? join(process.cwd(), ".data", "storage"));
    const full = resolve(root, path);
    const rel = relative(root, full);
    if (isAbsolute(path) || rel.startsWith("..") || isAbsolute(rel)) throw new PlatformError(400, "a local storage path must be a folder inside the server's storage root");
    return full;
  }

  async put(key: string, body: Uint8Array | string, contentType?: string) {
    const r = this.route(key);
    if (r) {
      const target = this.k.teams.settings(r.team).storage[r.category];
      const store = this.storeFor(r.team, target);
      if (store) {
        const out = await store.put(key, body, contentType);
        this.k.store.put<Location>(LOCATIONS, { id: key, team: r.team, category: r.category, target });
        return out;
      }
    }
    return this.base.put(key, body, contentType);
  }

  async get(key: string) {
    const loc = this.k.store.get<Location>(LOCATIONS, key);
    const store = loc ? this.storeFor(loc.team, loc.target) : undefined;
    return store ? store.get(key) : this.base.get(key);
  }

  async list(prefix: string) {
    const routed = this.k.store.list<Location>(LOCATIONS, (l) => l.id.startsWith(prefix)).map((l) => l.id);
    return [...new Set([...(await this.base.list(prefix)), ...routed])].sort();
  }

  /** Check a team's storage target by writing and reading a small object. */
  async test(teamId: string, category: StorageCategory): Promise<{ ok: boolean; error?: string }> {
    const target = this.k.teams.settings(teamId).storage[category];
    try {
      const store = this.storeFor(teamId, target) ?? this.base;
      const key = `.kiln-check/${newId("chk")}`;
      await store.put(key, "ok", "text/plain");
      const back = await store.get(key);
      return back && new TextDecoder().decode(back) === "ok" ? { ok: true } : { ok: false, error: "the object could not be read back" };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}
