import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { suitesInTree, summarize } from "@/lib/benchmarks";
import { api, safe } from "@/lib/kiln";
import { BenchmarkList, type SuiteCard } from "./_components/benchmark-list";

export const metadata: Metadata = { title: "Benchmarks" };

export default async function Benchmarks({ params }: { params: Promise<{ factory: string }> }) {
  const { factory } = await params;
  const [f, def, b] = await Promise.all([safe(() => api.factory(factory), null), safe(() => api.definition(factory), null), safe(() => api.benchmarks(factory), { suites: [], results: [], summary: {} })]);
  if (!f) notFound();
  const fromTree = suitesInTree(def?.tree ?? {});
  const suites: SuiteCard[] = (
    fromTree.length
      ? fromTree.map(({ suite, tasks }) => ({ slug: suite.slug, name: suite.name, description: suite.description, agent: suite.agent, tasks: tasks.length, configurations: suite.configurations.length }))
      : Object.entries(f.benchmarks).map(([slug, s]) => ({ slug, name: s.name, agent: s.agent, tasks: s.tasks.length, configurations: s.configurations.length }))
  ).map((s) => {
    const results = b.results.filter((r) => r.suite === s.slug || r.suite === s.name);
    const best = summarize(results)[0];
    return {
      ...s,
      agentType: f.agents.find((a) => a.name === s.agent)?.agentType,
      lastRun: results.reduce<string | undefined>((m, r) => (!m || r.at > m ? r.at : m), undefined),
      best: best ? { configuration: best.configuration, successRate: best.successRate, avgCostUsd: best.avgCostUsd } : undefined,
    };
  });
  return <BenchmarkList factory={factory} factoryName={f.factory.name} suites={suites} />;
}
