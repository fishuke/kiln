import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadResources } from "@/lib/api/resources";
import { api, safe } from "@/lib/kiln";
import { emptyScorer } from "@/lib/scorers";
import { ScorerPage } from "../_components/scorer-page";

export const metadata: Metadata = { title: "New scorer" };

export default async function NewScorer({ params }: { params: Promise<{ factory: string }> }) {
  const { factory } = await params;
  const f = await safe(() => api.factory(factory), null);
  if (!f) notFound();
  const res = await loadResources(factory, f);
  const judge = res.models.find((m) => /haiku|mini|flash/i.test(m)) ?? res.defaultModel;
  return <ScorerPage factory={factory} factoryName={f.factory.name} initial={emptyScorer(judge)} res={res} scores={[]} isNew />;
}
