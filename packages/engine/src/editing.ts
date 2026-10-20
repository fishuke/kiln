import { diffTrees, splitFrontmatter, validateTree, type DefinitionDiff, type DefinitionTree } from "@kiln/definitions";
import { Alias } from "@kiln/schema";
import { parse, stringify } from "yaml";
import { KilnError } from "./errors";
import type { Kiln } from "./kiln";
import { C, type Attachment, type FactoryBinding, type WorkItem } from "./types";

export type WriteResult =
  | { ok: true; mode: "applied"; sha: string; diff: DefinitionDiff; warnings: string[] }
  | { ok: true; mode: "pull_request"; prUrl: string; branch: string; diff: DefinitionDiff }
  | { ok: true; mode: "dry_run"; sha: string; diff: DefinitionDiff; warnings: string[] }
  | { ok: false; errors: string[] };

type Front = Record<string, unknown>;

const SAFE_PATH = /^(?!\/)(?!.*(^|\/)\.\.(\/|$))[A-Za-z0-9._ \/-]+$/;

/** Merge a patch into an object: undefined keeps, null deletes, anything else replaces. */
function mergeKeys(base: Front, patch: Front): Front {
  const out = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    if (v === null) delete out[k];
    else out[k] = v;
  }
  return out;
}

export function frontmatterFile(front: Front, body: string): string {
  const yaml = Object.keys(front).length ? stringify(front).trimEnd() : "";
  return `---\n${yaml}\n---\n${body.trim()}\n`;
}

export function readFrontmatter(src: string | undefined): { front: Front; body: string } {
  if (!src) return { front: {}, body: "" };
  const { yaml, body } = splitFrontmatter(src);
  return { front: ((yaml ? parse(yaml) : {}) ?? {}) as Front, body };
}

export type AgentSpec = {
  description?: string | null;
  prompt?: string;
  agentType?: string;
  harness?: { type: string; model?: string; reasoningLevel?: string; auth?: Record<string, unknown> | null } | null;
  model?: string | null;
  runner?: string | null;
  workerHost?: string | null;
  mcpServers?: string[] | null;
  secrets?: string[] | null;
  spawnableBy?: string[] | null;
  idleTimeoutMinutes?: number | null;
  computerUseModel?: string | null;
  computerUse?: boolean | null;
  credentialStrategy?: "EXECUTOR" | "CREATOR" | null;
  networkPolicy?: { allowedHosts?: string[]; deniedHosts?: string[] } | null;
  required_repos?: { owner: string; name: string }[] | null;
};

export type AutomationSpec = {
  enabled?: boolean;
  agent?: string | null;
  displayName?: string | null;
  triggers?: Record<string, unknown>[];
  prompt?: string;
  harness?: AgentSpec["harness"];
  model?: string | null;
  runner?: string | null;
  workerHost?: string | null;
  secrets?: string[] | null;
  mcpServers?: string[] | null;
};

export type SettingsPatch = {
  name?: string;
  alias?: string;
  description?: string | null;
  avatar?: string | null;
  repositories?: { owner: string; name: string; forge?: "github" | "gitlab"; deferred?: boolean }[];
  addRepositories?: { owner: string; name: string; forge?: "github" | "gitlab"; deferred?: boolean }[];
  removeRepositories?: { owner: string; name: string }[];
  integrations?: string[];
  credentialStrategy?: "EXECUTOR" | "CREATOR" | null;
  agentDefaults?: Front;
  scorerDefaults?: Front | null;
  cloudProviders?: Front | null;
  selfImprovement?: Front | null;
  benchmarkingModel?: string | null;
  networkPolicy?: Front | null;
  budgets?: Front | null;
  blueprint?: Front | null;
  experimental?: Front | null;
  defaultPipeline?: string | null;
};

/**
 * Edits factory definitions file by file. Kiln-managed factories validate and apply the whole
 * tree atomically; factories stored in a config repo get a branch and a pull request instead,
 * so a person merges every change.
 */
export class DefinitionEditor {
  constructor(private readonly k: Kiln) {}

  tree(factory: string): DefinitionTree {
    const b = this.k.defs.require(factory);
    return { ...(this.k.defs.tree(b.appliedSha!) ?? {}) };
  }

  file(factory: string, path: string): string | undefined {
    return this.tree(factory)[path];
  }

  managed(factory: string) {
    return !this.k.defs.require(factory).definitionRepo;
  }

  /** Change files (null deletes) and validate, then apply or open a pull request on the config repo. */
  async write(factory: string, changes: Record<string, string | null>, opts: { message: string; by: string; dryRun?: boolean }): Promise<WriteResult> {
    const binding = this.k.defs.require(factory);
    for (const path of Object.keys(changes)) if (!SAFE_PATH.test(path)) throw new KilnError("invalid_request", `invalid path ${path}`);
    const before = this.tree(factory);
    const after: DefinitionTree = { ...before };
    for (const [path, content] of Object.entries(changes)) {
      if (content === null) delete after[path];
      else after[path] = content;
    }
    const v = validateTree(after);
    if (!v.ok) return { ok: false, errors: v.errors.map((e) => `${e.file}:${e.line}: ${e.message}`) };
    const diff = diffTrees(before, after);
    if (opts.dryRun) return { ok: true, mode: "dry_run", sha: v.resolved.sha, diff, warnings: v.warnings.map((w) => `${w.file}:${w.line}: ${w.message}`) };
    if (binding.definitionRepo) {
      const repo = binding.definitionRepo;
      const branch = `kiln/definition-${this.k.clock.now().getTime().toString(36)}`;
      const files = Object.fromEntries(Object.entries(changes).map(([p, c]) => [repo.dir ? `${repo.dir}/${p}` : p, c]));
      await this.k.commitFiles(repo, branch, files, opts.message);
      const pr = await this.k.forge.openPullRequest({ repo, head: branch, base: repo.ref, title: opts.message.split("\n")[0]!.slice(0, 120), body: `${opts.message}\n\nRequested by ${opts.by} in Kiln. Merging applies it to the factory.`, labels: ["kiln:definition"] });
      this.k.audit(opts.by, "definition.pr_opened", factory, { pr: pr.url, paths: Object.keys(changes) });
      return { ok: true, mode: "pull_request", prUrl: pr.url, branch, diff };
    }
    const r = this.k.defs.apply(after, { author: opts.by, factory });
    if (!r.ok) return { ok: false, errors: r.errors };
    this.k.audit(opts.by, "definition.edited", factory, { message: opts.message, paths: Object.keys(changes) });
    return { ok: true, mode: "applied", sha: r.sha, diff: r.diff, warnings: r.warnings };
  }

  private must(r: WriteResult): WriteResult {
    if (!r.ok) throw new KilnError("invalid_request", `the definition would be invalid:\n${r.errors.join("\n")}`, { errors: r.errors });
    return r;
  }

  // ---- agents ----
  async upsertAgent(factory: string, name: string, spec: AgentSpec, by: string) {
    if (!/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,63}$/.test(name)) throw new KilnError("invalid_request", "agent names use letters, digits, spaces, dots, dashes and underscores");
    const path = `agents/${name}/agent.md`;
    const existing = this.file(factory, path);
    const { front, body } = readFrontmatter(existing);
    const { prompt, ...rest } = spec;
    if (!existing && prompt === undefined) throw new KilnError("invalid_request", "a new agent needs a prompt");
    if (rest.harness && rest.model === undefined && front.model !== undefined) rest.model = null;
    if (rest.model && rest.harness === undefined && front.harness !== undefined) {
      rest.harness = { ...(front.harness as Record<string, unknown>), model: rest.model } as AgentSpec["harness"];
      rest.model = null;
    }
    const next = mergeKeys({ agentType: "CUSTOM", ...front }, rest as Front);
    return this.must(await this.write(factory, { [path]: frontmatterFile(next, prompt ?? body) }, { message: `${existing ? "Update" : "Add"} agent ${name}`, by }));
  }

  async deleteAgent(factory: string, name: string, by: string) {
    const tree = this.tree(factory);
    const { front } = readFrontmatter(tree[`agents/${name}/agent.md`]);
    if (!tree[`agents/${name}/agent.md`]) throw new KilnError("resource_not_found", `factory ${factory} has no agent ${name}`);
    if (front.agentType === "FOREMAN") throw new KilnError("operation_not_supported", "the foreman cannot be deleted");
    const changes = Object.fromEntries(Object.keys(tree).filter((p) => p.startsWith(`agents/${name}/`)).map((p) => [p, null]));
    return this.must(await this.write(factory, changes, { message: `Remove agent ${name}`, by }));
  }

  // ---- automations ----
  async upsertAutomation(factory: string, name: string, spec: AutomationSpec, by: string) {
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(name)) throw new KilnError("invalid_request", "automation names use lowercase letters, digits and dashes");
    const path = `automations/${name}/automation.md`;
    const existing = this.file(factory, path);
    const { front, body } = readFrontmatter(existing);
    const { prompt, ...rest } = spec;
    if (!existing && !rest.triggers?.length) throw new KilnError("invalid_request", "a new automation needs at least one trigger");
    const next = mergeKeys(front, rest as Front);
    return this.must(await this.write(factory, { [path]: frontmatterFile(next, prompt ?? body) }, { message: `${existing ? "Update" : "Add"} automation ${name}`, by }));
  }

  async deleteAutomation(factory: string, name: string, by: string) {
    const path = `automations/${name}/automation.md`;
    if (!this.file(factory, path)) throw new KilnError("resource_not_found", `factory ${factory} has no automation ${name}`);
    return this.must(await this.write(factory, { [path]: null }, { message: `Remove automation ${name}`, by }));
  }

  // ---- runners, routers ----
  async upsertYaml(factory: string, dir: "runners" | "routers", name: string, value: Front, by: string) {
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(name)) throw new KilnError("invalid_request", `${dir} names use lowercase letters, digits and dashes`);
    const path = `${dir}/${name}.yaml`;
    const existing = this.file(factory, path);
    const base = existing ? ((parse(existing) ?? {}) as Front) : {};
    const next = dir === "routers" ? value : mergeKeys(base, value);
    return this.must(await this.write(factory, { [path]: stringify(next) }, { message: `${existing ? "Update" : "Add"} ${dir.slice(0, -1)} ${name}`, by }));
  }

  async deleteYaml(factory: string, dir: "runners" | "routers", name: string, by: string) {
    const path = `${dir}/${name}.yaml`;
    if (!this.file(factory, path)) throw new KilnError("resource_not_found", `factory ${factory} has no ${dir.slice(0, -1)} ${name}`);
    return this.must(await this.write(factory, { [path]: null }, { message: `Remove ${dir.slice(0, -1)} ${name}`, by }));
  }

  // ---- skills ----
  async upsertSkill(factory: string, name: string, spec: { description: string; body: string; owner?: string; version?: string; agent?: string }, by: string) {
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(name)) throw new KilnError("invalid_request", "skill names use lowercase letters, digits and dashes");
    const path = spec.agent ? `agents/${spec.agent}/skills/${name}/SKILL.md` : `skills/${name}/SKILL.md`;
    const front = mergeKeys({ name, description: spec.description }, { owner: spec.owner, version: spec.version });
    return this.must(await this.write(factory, { [path]: frontmatterFile(front, spec.body) }, { message: `${this.file(factory, path) ? "Update" : "Add"} skill ${name}`, by }));
  }

  async deleteSkill(factory: string, name: string, by: string, agent?: string) {
    const dir = agent ? `agents/${agent}/skills/${name}/` : `skills/${name}/`;
    const tree = this.tree(factory);
    const paths = Object.keys(tree).filter((p) => p.startsWith(dir));
    if (!paths.length) throw new KilnError("resource_not_found", `factory ${factory} has no skill ${name}`);
    return this.must(await this.write(factory, Object.fromEntries(paths.map((p) => [p, null])), { message: `Remove skill ${name}`, by }));
  }

  // ---- settings ----
  private aliasTaken(factory: string, alias: string): boolean {
    const want = alias.toLowerCase();
    return this.k.defs.list().some((f) => {
      if (f.id === factory) return false;
      const other = f.appliedSha ? (this.k.defs.resolved(f.appliedSha).factory.alias ?? f.alias) : f.alias;
      return other.toLowerCase() === want || f.id.toLowerCase() === want;
    });
  }

  checkAlias(alias: string, factory?: string) {
    const parsed = Alias.safeParse(alias);
    if (!parsed.success) throw new KilnError("invalid_request", parsed.error.issues[0]!.message);
    if (this.aliasTaken(factory ?? "", alias)) throw new KilnError("conflict", `the alias ${alias} is already used by another factory`);
  }

  async updateSettings(factory: string, patch: SettingsPatch, by: string) {
    const tree = this.tree(factory);
    const f = (parse(tree["factory.yaml"] ?? "") ?? {}) as Front;
    if (patch.alias !== undefined) {
      this.checkAlias(patch.alias, factory);
      f.alias = patch.alias;
    }
    if (patch.name !== undefined) f.name = patch.name;
    if (patch.description !== undefined) {
      if (patch.description === null) delete f.description;
      else f.description = patch.description;
    }
    type Repo = { owner: string; name: string; forge?: string; deferred?: boolean };
    let repos = (f.repositories as Repo[] | undefined) ?? [];
    if (patch.repositories) repos = patch.repositories;
    for (const r of patch.addRepositories ?? []) if (!repos.some((x) => x.owner === r.owner && x.name === r.name)) repos.push(r);
    if (patch.removeRepositories) repos = repos.filter((x) => !patch.removeRepositories!.some((r) => r.owner === x.owner && r.name === x.name));
    if (!repos.length) throw new KilnError("invalid_request", "a factory needs at least one repository");
    f.repositories = repos.map((r) => ({ ...(r.forge && r.forge !== "github" ? { forge: r.forge } : {}), owner: r.owner, name: r.name, ...(r.deferred ? { deferred: true } : {}) }));
    const set = (key: string, value: unknown) => {
      if (value === undefined) return;
      if (value === null) delete f[key];
      else f[key] = value;
    };
    set("integrations", patch.integrations);
    set("credentialStrategy", patch.credentialStrategy);
    set("avatar", patch.avatar);
    set("cloudProviders", patch.cloudProviders);
    if (patch.agentDefaults) f.agentDefaults = mergeKeys((f.agentDefaults as Front) ?? {}, patch.agentDefaults);
    set("scorerDefaults", patch.scorerDefaults === null ? null : patch.scorerDefaults && mergeKeys((f.scorerDefaults as Front) ?? {}, patch.scorerDefaults));
    set("selfImprovement", patch.selfImprovement === null ? null : patch.selfImprovement && mergeKeys((f.selfImprovement as Front) ?? {}, patch.selfImprovement));
    if (patch.benchmarkingModel !== undefined) set("scoring", patch.benchmarkingModel === null ? null : { ...((f.scoring as Front) ?? {}), defaultModel: patch.benchmarkingModel });
    set("networkPolicy", patch.networkPolicy);
    set("budgets", patch.budgets);
    set("blueprint", patch.blueprint);
    set("experimental", patch.experimental);
    set("defaultPipeline", patch.defaultPipeline);
    return this.must(await this.write(factory, { "factory.yaml": stringify(f) }, { message: "Update factory settings", by }));
  }

  /** Self-improvement settings and per-scorer toggles, in one change. */
  async updateSelfImprovement(
    factory: string,
    patch: { enabled?: boolean; failedRunThreshold?: number; maxAgeDays?: number; reviewers?: { type: string; emails?: string[] }; model?: string | null; scorers?: Record<string, boolean> },
    by: string,
  ) {
    const tree = this.tree(factory);
    const f = (parse(tree["factory.yaml"] ?? "") ?? {}) as Front;
    const { scorers, ...settings } = patch;
    const si = mergeKeys((f.selfImprovement as Front) ?? {}, settings as Front);
    const changes: Record<string, string> = { "factory.yaml": stringify({ ...f, selfImprovement: si }) };
    for (const [slug, on] of Object.entries(scorers ?? {})) {
      const path = `scorers/${slug}/scorer.md`;
      if (!tree[path]) throw new KilnError("resource_not_found", `factory ${factory} has no scorer ${slug}`);
      const { front, body } = readFrontmatter(tree[path]);
      changes[path] = frontmatterFile({ ...front, selfImprovement: on }, body);
    }
    return this.must(await this.write(factory, changes, { message: "Update self-improvement settings", by }));
  }

  async setAvatar(factory: string, file: Attachment, by: string) {
    const b = this.k.defs.require(factory);
    const bytes = await this.k.objects.get(file.key);
    if (!bytes) throw new KilnError("resource_not_found", `unknown file ${file.key}`);
    if (!/^image\//.test(file.contentType)) throw new KilnError("invalid_request", "an avatar must be an image");
    const key = `avatars/${factory}/${file.name}`;
    await this.k.objects.put(key, bytes, file.contentType);
    this.k.store.put<FactoryBinding>(C.factories, { ...b, avatarKey: key, updatedAt: this.k.clock.now().toISOString() });
    this.k.audit(by, "factory.avatar_set", factory, { key });
    return key;
  }

  /** Move a Kiln-managed factory into a GitHub repo: a pull request adds the files; the merge switches the factory over. */
  async migrateToRepo(factory: string, repo: { owner: string; name: string; ref?: string; dir?: string }, by: string) {
    const b = this.k.defs.require(factory);
    if (b.definitionRepo) throw new KilnError("conflict", `${factory} already lives in ${b.definitionRepo.owner}/${b.definitionRepo.name}`);
    const target = { owner: repo.owner, name: repo.name, ref: repo.ref ?? "main", dir: repo.dir ?? "" };
    const branch = `kiln/migrate-${factory}`.replace(/[^A-Za-z0-9/_-]+/g, "-");
    const files = Object.fromEntries(Object.entries(this.tree(factory)).map(([p, c]) => [target.dir ? `${target.dir}/${p}` : p, c]));
    await this.k.commitFiles(target, branch, files, `Move the ${factory} factory definition here`);
    const pr = await this.k.forge.openPullRequest({ repo: target, head: branch, base: target.ref, title: `Kiln factory definition: ${b.name}`, body: `The definition of the Kiln factory \`${factory}\`. Merging this makes the repo the source of truth: later merges apply automatically.`, labels: ["kiln:definition"] });
    const next: FactoryBinding = { ...b, migration: { ...target, branch, prUrl: pr.url }, updatedAt: this.k.clock.now().toISOString() };
    this.k.store.put(C.factories, next);
    this.k.audit(by, "factory.migration_opened", factory, { pr: pr.url });
    return { prUrl: pr.url, branch };
  }

  /** After the migration PR merged: bind the factory to the repo. Returns whether it switched. */
  async completeMigration(factory: string, by = "migration"): Promise<boolean> {
    const b = this.k.defs.require(factory);
    const m = b.migration;
    if (!m) return false;
    const tree = await this.k.forge.readTree(m, m.ref, m.dir).catch(() => ({}) as Record<string, string>);
    if (!tree["factory.yaml"]) return false;
    const definitionRepo = { owner: m.owner, name: m.name, ref: m.ref, dir: m.dir };
    const r = this.k.defs.apply(tree, { author: by, factory, definitionRepo });
    if (!r.ok) return false;
    const fresh = this.k.defs.require(factory);
    const { migration: _m, ...rest } = fresh;
    this.k.store.put(C.factories, { ...rest, definitionRepo, updatedAt: this.k.clock.now().toISOString() });
    this.k.audit(by, "factory.migrated", factory, { repo: `${m.owner}/${m.name}` });
    return true;
  }

}
