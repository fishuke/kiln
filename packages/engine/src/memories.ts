import { stringify } from "yaml";
import type { Kiln } from "./kiln";
import { C, newId, type Memory } from "./types";

const STOP = new Set(["the", "and", "for", "with", "that", "this", "from", "into", "when", "then", "are", "use", "you", "your", "not", "all", "any"]);

function tokens(s: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of s.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []) if (!STOP.has(t)) m.set(t, (m.get(t) ?? 0) + 1);
  return m;
}

function cosine(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0;
  for (const [k, v] of a) dot += v * (b.get(k) ?? 0);
  const n = (x: Map<string, number>) => Math.sqrt([...x.values()].reduce((s, v) => s + v * v, 0));
  return dot === 0 ? 0 : dot / (n(a) * n(b));
}

/**
 * Per-factory learnings. Proposed by agents or people, reviewed like skills, then stored as
 * `memories/<slug>.md` in the definition tree; this index ranks them for each new run.
 * (Production swaps the bag-of-words index for pgvector embeddings.)
 */
export class MemoryService {
  constructor(private readonly k: Kiln) {}

  list(factory: string, status?: Memory["status"]) {
    return this.k.store.list<Memory>(C.memories, (m) => m.factory === factory && (!status || m.status === status));
  }

  propose(factory: string, input: { title: string; body: string; tags?: string[]; author: string; sourceRunId?: string }): Memory {
    const slug = input.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "memory";
    const existing = this.list(factory).find((m) => m.slug === slug && m.status !== "rejected");
    if (existing) return existing;
    const m: Memory = { id: newId("mem"), factory, slug, title: input.title, body: input.body, tags: input.tags ?? [], author: input.author, status: "proposed", sourceRunId: input.sourceRunId, createdAt: this.k.clock.now().toISOString() };
    this.k.store.put(C.memories, m);
    return m;
  }

  /** Accepting writes the memory into the definition (directly, or as a PR for config repos). */
  async accept(id: string, by: string): Promise<Memory> {
    const m = this.k.store.get<Memory>(C.memories, id);
    if (!m) throw new Error(`unknown memory ${id}`);
    const next: Memory = { ...m, status: "accepted" };
    this.k.store.put(C.memories, next);
    const file = `memories/${m.slug}.md`;
    const content = `---\n${stringify({ title: m.title, tags: m.tags, author: m.author }).trimEnd()}\n---\n${m.body}\n`;
    const b = this.k.defs.require(m.factory);
    if (b.definitionRepo) {
      const repo = b.definitionRepo;
      const branch = `kiln/memory-${m.slug}`;
      await this.k.commitFiles(repo, branch, { [repo.dir ? `${repo.dir}/${file}` : file]: content }, `Remember: ${m.title}`);
      await this.k.forge.openPullRequest({ repo, head: branch, base: repo.ref, title: `Memory: ${m.title}`, body: m.body, labels: ["kiln:memory"] });
    } else {
      const tree = { ...this.k.defs.tree(b.appliedSha!)!, [file]: content };
      this.k.defs.apply(tree, { author: `memory:${m.id} accepted by ${by}`, factory: m.factory });
    }
    this.k.audit(by, "memory.accepted", id);
    return next;
  }

  reject(id: string, by: string) {
    const m = this.k.store.get<Memory>(C.memories, id);
    if (m) this.k.store.put(C.memories, { ...m, status: "rejected" });
    this.k.audit(by, "memory.rejected", id);
  }

  /** Accepted memories plus those already committed to the definition tree, ranked for a query. */
  recall(factory: string, query: string, limit = 5): { title: string; body: string; score: number }[] {
    const all = new Map<string, { title: string; body: string }>();
    for (const m of this.list(factory, "accepted")) all.set(m.slug, m);
    const b = this.k.defs.get(factory);
    if (b?.appliedSha) {
      for (const [slug, m] of Object.entries(this.k.defs.resolved(b.appliedSha).parsed.memories)) all.set(slug, { title: m.frontmatter.title, body: m.body });
    }
    const q = tokens(query);
    return [...all.values()]
      .map((m) => ({ ...m, score: cosine(q, tokens(`${m.title} ${m.body}`)) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .filter((m, i) => m.score > 0 || i < 3);
  }

  promptBlock(factory: string, query: string): string {
    const found = this.recall(factory, query);
    if (!found.length) return "";
    return ["## Factory memories", "Conventions and decisions this factory has learned. Follow them unless the request says otherwise.", ...found.map((m) => `- Convention: ${m.title}. ${m.body.trim()}`)].join("\n");
  }
}
