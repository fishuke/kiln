import { NodeCommandRunner, type CommandRunner } from "./process";

/**
 * Removes what Kiln leaves on a Docker host: stopped sandbox and service containers, images a newer
 * build superseded, and old build cache. It only touches Kiln's own containers and images (the
 * `kiln.sandbox` label and the Compose project Kiln runs in) and never removes a volume.
 */
export type JanitorOptions = {
  /** Compose project of Kiln's own services (Coolify: the resource id), or how to find it. Without it only sandboxes are cleaned. */
  project?: string | (() => Promise<string | undefined>);
  /** Tagged images kept per repository, newest first, for rollback. */
  keepImages?: number;
  /** Stopped containers younger than this stay (to read their logs). */
  containerMinAgeHours?: number;
  /** Superseded images younger than this stay (a deploy may still be starting). */
  imageMinAgeHours?: number;
  /** Build cache older than this goes, down to `buildCacheKeepBytes`. */
  buildCacheMaxAgeHours?: number;
  buildCacheKeepBytes?: number;
};

export type JanitorItem = { id: string; name: string; createdAt?: string; sizeBytes?: number; reason: string };
export type DiskUsageRow = { type: string; count: number; sizeBytes: number; reclaimableBytes: number };
export type VolumeReport = { name: string; inUse: boolean };
export type JanitorPlan = {
  project?: string;
  containers: JanitorItem[];
  images: JanitorItem[];
  buildCache: { olderThanHours: number; keepBytes: number };
  /** Reported only: the janitor never removes volumes. */
  volumes: VolumeReport[];
};
export type JanitorRun = {
  at: string;
  removed: { containers: string[]; images: string[] };
  failed: string[];
  before: DiskUsageRow[];
  after: DiskUsageRow[];
  reclaimedBytes: number;
};

const UNITS: Record<string, number> = { b: 1, kb: 1e3, mb: 1e6, gb: 1e9, tb: 1e12, kib: 1024, mib: 1024 ** 2, gib: 1024 ** 3, tib: 1024 ** 4 };

/** "12.5MiB", "1.2GB" or "0B" (docker stats, images, system df) to bytes. */
export function parseByteSize(s: string): number | undefined {
  const m = /^([\d.]+)\s*([a-z]+)/i.exec(s.trim());
  const unit = m && UNITS[m[2]!.toLowerCase()];
  return m && unit ? Math.round(Number(m[1]) * unit) : undefined;
}

/** Docker's "2026-10-23 10:11:12 +0000 UTC" to ISO; undefined when it does not parse. */
export function parseDockerTime(s: string | undefined): string | undefined {
  const t = s ? Date.parse(s.replace(/ [A-Z]{2,5}$/, "")) : NaN;
  return Number.isNaN(t) ? undefined : new Date(t).toISOString();
}

const lines = (s: string) =>
  s
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
const hoursOld = (iso: string | undefined, now: number) => (iso ? (now - Date.parse(iso)) / 3_600_000 : 0);

export class DockerJanitor {
  constructor(
    private readonly runner: CommandRunner = new NodeCommandRunner(),
    private readonly options: JanitorOptions = {},
    private readonly now: () => Date = () => new Date(),
  ) {}

  private resolved?: Promise<string | undefined>;
  private project() {
    const p = this.options.project;
    return (this.resolved ??= typeof p === "function" ? p() : Promise.resolve(p));
  }

  private async docker(args: string[]): Promise<string> {
    const r = await this.runner.run("docker", args);
    if (r.code !== 0) throw new Error(`docker ${args.slice(0, 2).join(" ")} failed: ${r.stderr.trim()}`);
    return r.stdout;
  }

  /** `docker system df`: images, containers, volumes and build cache for the whole host. */
  async diskUsage(): Promise<DiskUsageRow[]> {
    return lines(await this.docker(["system", "df", "--format", "{{json .}}"])).map((l) => {
      const row = JSON.parse(l) as { Type: string; TotalCount: string; Size: string; Reclaimable: string };
      return {
        type: row.Type,
        count: Number(row.TotalCount) || 0,
        sizeBytes: parseByteSize(row.Size) ?? 0,
        reclaimableBytes: parseByteSize(row.Reclaimable) ?? 0,
      };
    });
  }

  /** What `run` would remove. Read-only. */
  async plan(): Promise<JanitorPlan> {
    const o = {
      keepImages: 2,
      containerMinAgeHours: 24,
      imageMinAgeHours: 24,
      buildCacheMaxAgeHours: 168,
      buildCacheKeepBytes: 10 * 1024 ** 3,
      ...this.options,
      project: await this.project(),
    };
    const now = this.now().getTime();
    const filters = [["--filter", "label=kiln.sandbox=1"], ...(o.project ? [["--filter", `label=com.docker.compose.project=${o.project}`]] : [])];

    const containers = new Map<string, JanitorItem>();
    const usedImages = new Set<string>();
    for (const f of filters) {
      for (const l of lines(await this.docker(["ps", "-a", ...f, "--format", "{{.ID}}\t{{.Names}}\t{{.State}}\t{{.CreatedAt}}\t{{.Image}}"]))) {
        const [id, name, state, created, image] = l.split("\t");
        if (image) usedImages.add(image);
        const createdAt = parseDockerTime(created);
        if (state === "running" || state === "restarting" || state === "paused" || hoursOld(createdAt, now) < o.containerMinAgeHours) continue;
        containers.set(id!, { id: id!, name: name!, ...(createdAt ? { createdAt } : {}), reason: `${state}, older than ${o.containerMinAgeHours}h` });
      }
    }
    // Images of containers that stay (running ones, and stopped ones too young to remove) are in use.
    for (const l of lines(await this.docker(["ps", "-a", "--format", "{{.ID}}\t{{.Image}}"]))) {
      const [id, image] = l.split("\t");
      if (!containers.has(id!) && image) usedImages.add(image);
    }

    const images: JanitorItem[] = [];
    if (o.project) {
      type Row = { ID: string; Repository: string; Tag: string; CreatedAt: string; Size: string; Containers?: string };
      const rows = lines(await this.docker(["images", "--filter", `label=com.docker.compose.project=${o.project}`, "--format", "{{json .}}"])).map(
        (l) => JSON.parse(l) as Row,
      );
      const byRepo = new Map<string, Row[]>();
      for (const r of rows) byRepo.set(r.Repository, [...(byRepo.get(r.Repository) ?? []), r]);
      for (const [repo, list] of byRepo) {
        list.sort((a, b) => (parseDockerTime(b.CreatedAt) ?? "").localeCompare(parseDockerTime(a.CreatedAt) ?? ""));
        list.forEach((r, i) => {
          const dangling = repo === "<none>";
          const ref = dangling ? r.ID : `${repo}:${r.Tag}`;
          const inUse =
            usedImages.has(ref) ||
            usedImages.has(r.ID) ||
            (dangling ? false : usedImages.has(repo) && r.Tag === "latest") ||
            (r.Containers !== undefined && r.Containers !== "N/A" && r.Containers !== "0");
          const createdAt = parseDockerTime(r.CreatedAt);
          if (inUse || (!dangling && i < o.keepImages) || hoursOld(createdAt, now) < o.imageMinAgeHours) return;
          images.push({
            id: r.ID,
            name: ref,
            ...(createdAt ? { createdAt } : {}),
            ...(parseByteSize(r.Size) !== undefined ? { sizeBytes: parseByteSize(r.Size)! } : {}),
            reason: dangling ? "dangling: a newer build replaced it" : `older than the newest ${o.keepImages}`,
          });
        });
      }
    }

    const volumes: VolumeReport[] = [];
    for (const name of lines(await this.docker(["volume", "ls", "--filter", "name=kiln-data", "--format", "{{.Name}}"]))) {
      volumes.push({ name, inUse: lines(await this.docker(["ps", "-a", "-q", "--filter", `volume=${name}`])).length > 0 });
    }
    return {
      ...(o.project ? { project: o.project } : {}),
      containers: [...containers.values()],
      images,
      buildCache: { olderThanHours: o.buildCacheMaxAgeHours, keepBytes: o.buildCacheKeepBytes },
      volumes,
    };
  }

  /** Remove what the plan lists, prune old build cache, and measure the space reclaimed. */
  async run(): Promise<JanitorRun> {
    const before = await this.diskUsage();
    const plan = await this.plan();
    const removed = { containers: [] as string[], images: [] as string[] };
    const failed: string[] = [];
    for (const c of plan.containers) {
      // -v: the container's anonymous volumes go with it; named volumes never do.
      const r = await this.runner.run("docker", ["rm", "-f", "-v", c.id]);
      (r.code === 0 ? removed.containers : failed).push(c.name);
    }
    for (const i of plan.images) {
      // No -f: Docker refuses an image a container still uses, which is the last guard.
      const r = await this.runner.run("docker", ["rmi", i.id]);
      (r.code === 0 ? removed.images : failed).push(i.name);
    }
    const prune = await this.runner.run("docker", [
      "builder",
      "prune",
      "-f",
      "--filter",
      `until=${plan.buildCache.olderThanHours}h`,
      "--keep-storage",
      String(plan.buildCache.keepBytes),
    ]);
    if (prune.code !== 0) failed.push(`build cache: ${prune.stderr.trim()}`);
    const after = await this.diskUsage();
    const used = (rows: DiskUsageRow[]) => rows.reduce((n, r) => n + r.sizeBytes, 0);
    return { at: this.now().toISOString(), removed, failed, before, after, reclaimedBytes: Math.max(0, used(before) - used(after)) };
  }
}

/** The Compose project of the container this process runs in (KILN_COMPOSE_PROJECT overrides). */
export async function composeProjectOfSelf(
  runner: CommandRunner = new NodeCommandRunner(),
  env = process.env,
  host = env.HOSTNAME,
): Promise<string | undefined> {
  if (env.KILN_COMPOSE_PROJECT) return env.KILN_COMPOSE_PROJECT;
  if (!host) return undefined;
  const r = await runner.run("docker", ["inspect", "--format", '{{index .Config.Labels "com.docker.compose.project"}}', host]);
  const project = r.code === 0 ? r.stdout.trim() : "";
  return project && project !== "<no value>" ? project : undefined;
}
