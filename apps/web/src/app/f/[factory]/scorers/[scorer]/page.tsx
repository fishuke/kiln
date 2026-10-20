import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadResources } from "@/lib/api/resources";
import { api, safe } from "@/lib/kiln";
import { loadScorers } from "../_components/load";
import { ScorerPage } from "../_components/scorer-page";

type Params = { params: Promise<{ factory: string; scorer: string }>; searchParams: Promise<{ tab?: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  return { title: `Scorers — ${decodeURIComponent((await params).scorer)}` };
}

export default async function ScorerDetail({ params, searchParams }: Params) {
  const { factory, scorer } = await params;
  const { tab } = await searchParams;
  const slug = decodeURIComponent(scorer);
  const loaded = await loadScorers(factory);
  const s = loaded?.scorers.find((x) => x.slug === slug);
  if (!loaded || !s) notFound();
  const [scores, res] = await Promise.all([safe(() => api.scores(factory), []), loadResources(factory, loaded.f)]);
  const rows = scores
    .filter((x) => x.scorer === s.name || x.scorer === s.slug)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((x) => ({ id: x.id, runId: x.runId, runHref: `/runs/${x.runId}`, agent: x.agent, label: x.label, score: x.score, passed: x.passed, rationale: x.rationale, createdAt: x.createdAt, costUsd: (x as { costUsd?: number }).costUsd }));
  return <ScorerPage key={slug} factory={factory} factoryName={loaded.f.factory.name} initial={s} res={res} scores={rows} initialTab={tab === "config" ? "config" : "details"} />;
}
