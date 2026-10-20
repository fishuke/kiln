import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { api, safe } from "@/lib/kiln";
import { NewBenchmark } from "../_components/new-benchmark";

export const metadata: Metadata = { title: "New benchmark" };

export default async function NewBenchmarkPage({ params }: { params: Promise<{ factory: string }> }) {
  const { factory } = await params;
  const f = await safe(() => api.factory(factory), null);
  if (!f) notFound();
  return <NewBenchmark factory={factory} factoryName={f.factory.name} agents={f.agents.map((a) => ({ name: a.name, agentType: a.agentType }))} />;
}
