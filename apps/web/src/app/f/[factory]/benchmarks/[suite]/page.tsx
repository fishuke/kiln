import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadResources } from "@/lib/api/resources";
import { suitesInTree } from "@/lib/benchmarks";
import { api, safe } from "@/lib/kiln";
import { SuiteView } from "../_components/suite-view";

type Params = { params: Promise<{ factory: string; suite: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  return { title: `Benchmarks — ${decodeURIComponent((await params).suite)}` };
}

export default async function SuitePage({ params }: Params) {
  const { factory, suite: raw } = await params;
  const slug = decodeURIComponent(raw);
  const [f, def, b] = await Promise.all([safe(() => api.factory(factory), null), safe(() => api.definition(factory), null), safe(() => api.benchmarks(factory), { suites: [], results: [], summary: {} })]);
  if (!f) notFound();
  const found = suitesInTree(def?.tree ?? {}).find((s) => s.suite.slug === slug);
  if (!found) notFound();
  const res = await loadResources(factory, f);
  const results = b.results
    .filter((r) => r.suite === slug || r.suite === found.suite.name)
    .map((r) => ({ configuration: r.configuration, task: r.task, runId: r.runId, success: r.success, score: r.score, costUsd: r.costUsd, durationMs: r.durationMs, at: r.at }));
  return (
    <SuiteView
      factory={factory}
      factoryName={f.factory.name}
      suite={found.suite}
      tasks={found.tasks}
      agentType={f.agents.find((a) => a.name === found.suite.agent)?.agentType}
      results={results}
      resources={{ models: res.models, routers: res.routers, harnesses: res.harnesses, runners: res.runners, scorers: Object.values(f.scorers).map((s) => s.name) }}
    />
  );
}
