import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { api, safe } from "@/lib/kiln";
import { DefinitionEditor } from "./_components/definition-editor";

export const metadata: Metadata = { title: "Factory definition" };

export default async function Definition({ params, searchParams }: { params: Promise<{ factory: string }>; searchParams: Promise<{ file?: string; sha?: string; import?: string }> }) {
  const { factory } = await params;
  const sp = await searchParams;
  const [f, def] = await Promise.all([safe(() => api.factory(factory), null), safe(() => api.definition(factory, sp.sha), null)]);
  if (!f || !def) notFound();
  const foreman = f.agents.find((a) => a.agentType === "FOREMAN")?.name;
  const judge = Object.values(f.scorers)[0]?.model;
  return (
    <DefinitionEditor
      key={def.sha}
      factory={factory}
      factoryName={f.factory.name}
      tree={def.tree}
      sha={def.sha}
      repo={f.factory.definitionRepo ? { owner: f.factory.definitionRepo.owner, name: f.factory.definitionRepo.name, ref: f.factory.definitionRepo.ref ?? "main", dir: f.factory.definitionRepo.dir || undefined } : undefined}
      initialFile={sp.file}
      importMode={sp.import === "1"}
      defaultAgent={f.agents.find((a) => a.agentType === "IMPLEMENT")?.name ?? foreman}
      judgeModel={judge}
    />
  );
}
