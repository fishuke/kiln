import { createHash } from "node:crypto";
import { diffTrees, formatErrors, importV1alpha1, treeSha, validateTree, type DefinitionDiff, type DefinitionTree, type ResolvedFactory } from "@kiln/definitions";
import type { Kiln } from "./kiln";
import { C, type DefinitionRecord, type FactoryBinding } from "./types";

export type ApplyResult =
  | { ok: true; factory: string; sha: string; diff: DefinitionDiff; canaryPercent?: number; dryRun: boolean; warnings: string[] }
  | { ok: false; factory?: string; sha: string; errors: string[]; keptSha?: string };

/** Stable bucket 0..99 for canary routing. */
export function bucket(key: string): number {
  return parseInt(createHash("sha256").update(key).digest("hex").slice(0, 8), 16) % 100;
}

export class DefinitionService {
  private readonly cache = new Map<string, ResolvedFactory>();

  constructor(private readonly k: Kiln) {}

  list(): FactoryBinding[] {
    return this.k.store.list<FactoryBinding>(C.factories).sort((a, b) => a.name.localeCompare(b.name));
  }

  get(factory: string): FactoryBinding | undefined {
    return this.k.store.get<FactoryBinding>(C.factories, factory);
  }

  require(factory: string): FactoryBinding {
    const b = this.get(factory);
    if (!b) throw new Error(`unknown factory ${factory}`);
    return b;
  }

  tree(sha: string): DefinitionTree | undefined {
    return this.k.store.get<DefinitionRecord>(C.definitions, sha)?.tree;
  }

  /** Validated definition at a sha (cached). */
  resolved(sha: string): ResolvedFactory {
    const hit = this.cache.get(sha);
    if (hit) return hit;
    const tree = this.tree(sha);
    if (!tree) throw new Error(`definition ${sha} not found`);
    return this.resolveTree(tree);
  }

  resolveTree(tree: DefinitionTree): ResolvedFactory {
    const sha = treeSha(tree);
    const hit = this.cache.get(sha);
    if (hit) return hit;
    const result = validateTree(tree);
    if (!result.ok) throw new Error(`definition ${sha} is invalid:\n${formatErrors(result.errors)}`);
    this.cache.set(sha, result.resolved);
    return result.resolved;
  }

  current(factory: string): ResolvedFactory {
    const b = this.require(factory);
    if (!b.appliedSha) throw new Error(`factory ${factory} has no applied definition`);
    return this.resolved(b.appliedSha);
  }

  /** The definition a new work item runs under: the canary share goes to the candidate. */
  shaFor(factory: string, workItemId: string): string {
    const b = this.require(factory);
    if (b.canary && bucket(workItemId) < b.canary.percent) return b.canary.sha;
    if (!b.appliedSha) throw new Error(`factory ${factory} has no applied definition`);
    return b.appliedSha;
  }

  validate(tree: DefinitionTree) {
    const r = validateTree(tree);
    return r.ok
      ? { ok: true as const, sha: r.resolved.sha, warnings: r.warnings.map((w) => `${w.file}:${w.line}: ${w.message}`) }
      : { ok: false as const, sha: r.parsed.sha, errors: r.errors.map((e) => `${e.file}:${e.line}: ${e.message}`) };
  }

  diff(factory: string, tree: DefinitionTree): DefinitionDiff {
    const b = this.get(factory);
    return diffTrees(b?.appliedSha ? this.tree(b.appliedSha) : undefined, tree);
  }

  /**
   * Apply a whole tree or nothing. An invalid tree is recorded and rejected; the last valid
   * definition stays active. With `canaryPercent`, only that share of new work items uses it.
   */
  apply(
    tree: DefinitionTree,
    opts: { author: string; factory?: string; canaryPercent?: number; dryRun?: boolean; definitionRepo?: FactoryBinding["definitionRepo"] },
  ): ApplyResult {
    const now = this.k.clock.now().toISOString();
    const result = validateTree(tree);
    const sha = result.parsed.sha;
    const named = result.parsed.factory;
    // The factory id is the alias as a slug ("Web Platform" → web-platform); existing ids never change.
    const factoryId = opts.factory ?? (named ? slug(named.alias ?? named.name) : undefined);
    if (!result.ok) {
      const errors = result.errors.map((e) => `${e.file}:${e.line}: ${e.message}`);
      if (!opts.dryRun) {
        this.k.store.put<DefinitionRecord>(C.definitions, { id: sha, factory: factoryId ?? "unknown", tree, author: opts.author, createdAt: now, valid: false, errors });
        const b = factoryId ? this.get(factoryId) : undefined;
        if (b) this.k.store.put(C.factories, { ...b, lastError: errors[0], updatedAt: now });
        this.k.bus.publish("definition.rejected", { factory: factoryId ?? "unknown", sha, errors: errors.length });
        this.k.audit(opts.author, "definition.rejected", factoryId ?? "unknown", { sha, errors });
      }
      return { ok: false, factory: factoryId, sha, errors, keptSha: factoryId ? this.get(factoryId)?.appliedSha : undefined };
    }
    const id = factoryId!;
    // Alias filters (teams, channels, …) must resolve against the connected providers.
    const aliasErrors = this.k.automations.resolveAliases(result.resolved, { save: !opts.dryRun }).errors;
    if (aliasErrors.length) {
      if (!opts.dryRun) this.k.audit(opts.author, "definition.rejected", id, { sha, errors: aliasErrors });
      return { ok: false, factory: id, sha, errors: aliasErrors, keptSha: this.get(id)?.appliedSha };
    }
    const existing = this.get(id);
    const diff = diffTrees(existing?.appliedSha ? this.tree(existing.appliedSha) : undefined, tree);
    const warnings = [...result.warnings.map((w) => `${w.file}:${w.line}: ${w.message}`), ...this.k.automations.webhookWarnings(result.resolved, id)];
    if (opts.dryRun) return { ok: true, factory: id, sha, diff, dryRun: true, warnings, canaryPercent: opts.canaryPercent };

    this.k.store.transaction((s) => {
      s.put<DefinitionRecord>(C.definitions, { id: sha, factory: id, tree, author: opts.author, createdAt: now, valid: true });
      const base: FactoryBinding = existing ?? {
        id,
        name: result.resolved.factory.name,
        alias: result.resolved.factory.alias ?? id,
        status: "active",
        createdAt: now,
        updatedAt: now,
      };
      const next: FactoryBinding = { ...base, name: result.resolved.factory.name, status: "active", lastError: undefined, updatedAt: now };
      if (opts.definitionRepo) next.definitionRepo = opts.definitionRepo;
      if (opts.canaryPercent !== undefined && existing?.appliedSha && opts.canaryPercent < 100) {
        next.canary = { sha, percent: opts.canaryPercent, since: now };
      } else {
        next.previousSha = existing?.appliedSha;
        next.appliedSha = sha;
        next.canary = undefined;
      }
      s.put(C.factories, next);
    });
    this.cache.set(sha, result.resolved);
    this.k.bus.publish("definition.applied", { factory: id, sha, canaryPercent: opts.canaryPercent });
    this.k.audit(opts.author, "definition.applied", id, { sha, diff, canaryPercent: opts.canaryPercent });
    return { ok: true, factory: id, sha, diff, dryRun: false, warnings, canaryPercent: opts.canaryPercent };
  }

  promoteCanary(factory: string, by: string) {
    const b = this.require(factory);
    if (!b.canary) throw new Error(`${factory} has no canary`);
    const now = this.k.clock.now().toISOString();
    this.k.store.put(C.factories, { ...b, previousSha: b.appliedSha, appliedSha: b.canary.sha, canary: undefined, updatedAt: now });
    this.k.audit(by, "canary.promoted", factory, { sha: b.canary.sha });
  }

  rollbackCanary(factory: string, by: string) {
    const b = this.require(factory);
    if (!b.canary) return;
    this.k.store.put(C.factories, { ...b, canary: undefined, updatedAt: this.k.clock.now().toISOString() });
    this.k.audit(by, "canary.rolled_back", factory, { sha: b.canary.sha });
  }

  /** Pull the tree from the factory's GitHub config repo and apply it. */
  async syncFromRepo(factory: string, by = "repo-sync"): Promise<ApplyResult> {
    const b = this.require(factory);
    if (!b.definitionRepo) throw new Error(`${factory} has no definition repo`);
    const tree = await this.k.forge.readTree(b.definitionRepo, b.definitionRepo.ref, b.definitionRepo.dir);
    const incoming = /schemaVersion:\s*v1alpha1/.test(tree["factory.yaml"] ?? "") ? importV1alpha1(tree).tree : tree;
    // A merged self-improvement PR ships as a canary first, like an approval inside Kiln.
    const proposal = this.k.improvement.list(factory).find((p) => p.state === "open" && p.candidateSha === treeSha(incoming));
    const r = this.apply(incoming, { author: by, factory, canaryPercent: proposal ? (this.k.options.canaryPercent ?? 10) : undefined });
    if (proposal && r.ok) this.k.store.put("proposals", { ...proposal, state: "merged" });
    return r;
  }

  /** Bind a factory to a config repo and apply what is on its default branch. */
  async connectRepo(repo: { owner: string; name: string; ref?: string; dir?: string }, by: string): Promise<ApplyResult> {
    const definitionRepo = { owner: repo.owner, name: repo.name, ref: repo.ref ?? "main", dir: repo.dir ?? "" };
    const tree = await this.k.forge.readTree(definitionRepo, definitionRepo.ref, definitionRepo.dir);
    return this.applyAny(tree, { author: by, definitionRepo });
  }

  /**
   * Delete a factory: cancel its open work, drop its binding, members and managed webhooks, and
   * remove what it set up in connected systems (the `factory:<alias>` labels). Stored definitions,
   * runs and audit history stay for the record. Irreversible.
   */
  async remove(factory: string, by: string): Promise<{ factory: string; cancelled: string[] }> {
    const b = this.require(factory);
    const repos = b.appliedSha ? this.resolved(b.appliedSha).factory.repositories.map((r) => ({ owner: r.owner, name: r.name, forge: r.forge })) : [];
    const cancelled: string[] = [];
    for (const wi of this.k.workflow.list({ factory })) {
      if (["complete", "cancelled", "failed"].includes(wi.state)) continue;
      await this.k.workflow.cancel(wi.id, by).catch(() => undefined);
      cancelled.push(wi.id);
    }
    await this.k.integrations.cleanupFactory(b, repos.filter((r) => r.forge === "github" || r.forge === "gitlab"));
    for (const w of this.k.store.list<{ id: string; factory: string; secretName: string }>(C.webhookSources, (x) => x.factory === factory)) {
      this.k.store.delete(C.webhookSources, w.id);
      this.k.store.delete(C.secrets, w.secretName);
    }
    for (const m of this.k.store.list<{ id: string; factory: string }>("factory_members", (x) => x.factory === factory)) this.k.store.delete("factory_members", m.id);
    this.k.store.delete(C.factories, factory);
    this.k.audit(by, "factory.deleted", factory, { name: b.name, alias: b.alias, cancelled });
    return { factory, cancelled };
  }

  /** Accept kiln/v1 and v1alpha1 trees alike. */
  applyAny(tree: DefinitionTree, opts: Parameters<DefinitionService["apply"]>[1]): ApplyResult {
    const factoryYaml = tree["factory.yaml"] ?? "";
    if (/schemaVersion:\s*v1alpha1/.test(factoryYaml)) {
      return this.apply(importV1alpha1(tree).tree, opts);
    }
    return this.apply(tree, opts);
  }
}

export function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
