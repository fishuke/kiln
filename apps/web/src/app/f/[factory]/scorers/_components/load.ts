import "server-only";
import { api, safe } from "@/lib/kiln";
import { parseScorer, scorerSlugs, type ScorerModel } from "@/lib/scorers";

/** Scorers from the definition files; falls back to the resolved definition when files are unavailable. */
export async function loadScorers(factory: string): Promise<{ f: Awaited<ReturnType<typeof api.factory>>; scorers: ScorerModel[] } | null> {
  const [f, def] = await Promise.all([safe(() => api.factory(factory), null), safe(() => api.definition(factory), null)]);
  if (!f) return null;
  const tree = def?.tree ?? {};
  const slugs = scorerSlugs(tree);
  const scorers = slugs.length
    ? slugs.flatMap((slug) => {
        try {
          return [parseScorer(slug, tree[`scorers/${slug}/scorer.md`]!)];
        } catch {
          return [];
        }
      })
    : Object.entries(f.scorers).map(([slug, s]) => ({
        slug,
        name: s.name,
        agents: s.agents.map((name) => ({ name, includeDescendants: false })),
        labels: s.labels,
        passingScore: s.passingScore,
        samplingRate: s.samplingRate,
        model: s.model,
        selfImprovement: s.selfImprovement,
        rubric: s.rubric,
        extra: {},
      }));
  return { f, scorers };
}
