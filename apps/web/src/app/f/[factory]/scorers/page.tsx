import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadResources } from "@/lib/api/resources";
import { api, safe } from "@/lib/kiln";
import { DEFAULT_SCORERS } from "@/lib/scorers";
import { ScorersView, type ScorerCard } from "./_components/scorer-list";
import { loadScorers } from "./_components/load";

export const metadata: Metadata = { title: "Scorers" };

export default async function Scorers({ params }: { params: Promise<{ factory: string }> }) {
  const { factory } = await params;
  const loaded = await loadScorers(factory);
  if (!loaded) notFound();
  const { f, scorers } = loaded;
  const [scores, res] = await Promise.all([safe(() => api.scores(factory), []), loadResources(factory, f)]);
  const cards: ScorerCard[] = scorers.map((s) => {
    const mine = scores.filter((x) => x.scorer === s.name || x.scorer === s.slug);
    return { slug: s.slug, name: s.name, classifications: s.labels.length, agents: s.agents.map((a) => a.name), scored: mine.length, passRate: mine.length ? mine.filter((x) => x.passed).length / mine.length : undefined };
  });
  const have = new Set(scorers.flatMap((s) => [s.slug, s.name.toLowerCase()]));
  const missing = DEFAULT_SCORERS.filter((d) => !have.has(d.slug) && !have.has(d.name.toLowerCase())).map((d) => ({ slug: d.slug, name: d.name, description: d.description }));
  const judgeModel = res.models.find((m) => /haiku|mini|flash/i.test(m)) ?? res.defaultModel;
  return <ScorersView factory={factory} factoryName={f.factory.name} cards={cards} missingDefaults={missing} judgeModel={judgeModel} />;
}
