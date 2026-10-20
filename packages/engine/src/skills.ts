import { stringify } from "yaml";
import type { Kiln } from "./kiln";
import { C, newId, type SkillListing } from "./types";

/** Org-wide skills catalog: owners, versions, usage; installing a skill is a definition change. */
export class SkillService {
  private readonly usage = new Map<string, number>();

  constructor(private readonly k: Kiln) {}

  recordUsage(factory: string, skills: string[]) {
    for (const s of skills) this.usage.set(`${factory}/${s}`, (this.usage.get(`${factory}/${s}`) ?? 0) + 1);
    for (const l of this.listings()) {
      if (skills.includes(l.name) && (l.sourceFactory === factory || l.installs.some((i) => i.factory === factory))) {
        this.k.store.put(C.skills, { ...l, usage: l.usage + 1 });
      }
    }
  }

  /** Published skills, or one team's (listings carry the source factory's team). */
  listings(team?: string): SkillListing[] {
    return this.k.store.list<SkillListing>(C.skills, (l) => !team || this.listingTeam(l) === team).sort((a, b) => a.name.localeCompare(b.name));
  }

  listingTeam(l: SkillListing): string | undefined {
    return l.team ?? this.k.teams.factoryTeam(l.sourceFactory);
  }

  /** Every skill visible in the org: published listings and skills that live in factory trees. */
  catalog(team?: string) {
    const rows: { name: string; description: string; owner: string; version: string; factories: string[]; usage: number; listingId?: string }[] = [];
    for (const l of this.listings(team)) {
      rows.push({ name: l.name, description: l.description, owner: l.owner, version: l.version, factories: [l.sourceFactory, ...l.installs.map((i) => i.factory)], usage: l.usage, listingId: l.id });
    }
    for (const f of this.k.defs.list()) {
      if (!f.appliedSha || (team && this.k.teams.factoryTeam(f) !== team)) continue;
      for (const [name, s] of Object.entries(this.k.defs.resolved(f.appliedSha).parsed.skills)) {
        const row = rows.find((r) => r.name === name);
        if (row) {
          if (!row.factories.includes(f.id)) row.factories.push(f.id);
          continue;
        }
        rows.push({ name, description: s.frontmatter.description, owner: s.frontmatter.owner ?? f.id, version: s.frontmatter.version ?? "0", factories: [f.id], usage: this.usage.get(`${f.id}/${name}`) ?? 0 });
      }
    }
    return rows.sort((a, b) => b.usage - a.usage || a.name.localeCompare(b.name));
  }

  publish(factory: string, name: string, by: string): SkillListing {
    const b = this.k.defs.require(factory);
    const skill = this.k.defs.resolved(b.appliedSha!).parsed.skills[name];
    if (!skill) throw new Error(`${factory} has no shared skill ${name}`);
    const existing = this.listings().find((l) => l.name === name && l.sourceFactory === factory);
    const listing: SkillListing = {
      id: existing?.id ?? newId("skill"),
      name,
      description: skill.frontmatter.description,
      owner: skill.frontmatter.owner ?? by,
      version: skill.frontmatter.version ?? (existing ? String(Number(existing.version) + 1) : "1"),
      sourceFactory: factory,
      body: skill.body,
      installs: existing?.installs ?? [],
      usage: existing?.usage ?? 0,
      publishedAt: this.k.clock.now().toISOString(),
      team: this.k.teams.factoryTeam(factory),
    };
    this.k.store.put(C.skills, listing);
    this.k.audit(by, "skill.published", listing.id, { factory, name });
    return listing;
  }

  /** Install into another factory: a PR to its config repo, or a direct apply for managed factories. */
  async install(listingId: string, factory: string, by: string): Promise<{ prUrl?: string; sha?: string }> {
    const l = this.k.store.get<SkillListing>(C.skills, listingId);
    if (!l) throw new Error(`unknown skill ${listingId}`);
    const b = this.k.defs.require(factory);
    if (this.listingTeam(l) !== this.k.teams.factoryTeam(b)) throw new Error(`unknown skill ${listingId}`);
    const file = `skills/${l.name}/SKILL.md`;
    const content = `---\n${stringify({ name: l.name, description: l.description, owner: l.owner, version: l.version }).trimEnd()}\n---\n${l.body}\n`;
    let out: { prUrl?: string; sha?: string };
    if (b.definitionRepo) {
      const repo = b.definitionRepo;
      const branch = `kiln/skill-${l.name}-${l.version}`;
      await this.k.commitFiles(repo, branch, { [repo.dir ? `${repo.dir}/${file}` : file]: content }, `Install skill ${l.name} v${l.version}`);
      const pr = await this.k.forge.openPullRequest({ repo, head: branch, base: repo.ref, title: `Install skill ${l.name}`, body: `${l.description}\n\nFrom ${l.sourceFactory}, owner ${l.owner}.`, labels: ["kiln:skills"] });
      out = { prUrl: pr.url };
    } else {
      const r = this.k.defs.apply({ ...this.k.defs.tree(b.appliedSha!)!, [file]: content }, { author: `skill:${l.id} installed by ${by}`, factory });
      if (!r.ok) throw new Error(r.errors[0]);
      out = { sha: r.sha };
    }
    this.k.store.put(C.skills, { ...l, installs: [...l.installs, { factory, at: this.k.clock.now().toISOString(), prUrl: out.prUrl }] });
    this.k.audit(by, "skill.installed", listingId, { factory, ...out });
    return out;
  }
}
