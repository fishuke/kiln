import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AGENT_TEMPLATES } from "@/lib/agent-catalog";
import { emptyAgentForm } from "@/lib/agent-file";
import { AgentEditor } from "../[agent]/agent-editor";
import { loadAgentContext, otherAgents } from "../[agent]/load";

export const metadata: Metadata = { title: "New agent" };

export default async function NewAgent({ params, searchParams }: { params: Promise<{ factory: string }>; searchParams: Promise<{ type?: string }> }) {
  const { factory } = await params;
  const { type } = await searchParams;
  const ctx = await loadAgentContext(factory);
  if (!ctx) notFound();
  const agentType = type && AGENT_TEMPLATES[type] ? type : "CUSTOM";
  const t = AGENT_TEMPLATES[agentType]!;
  const initial = { ...emptyAgentForm(agentType), description: t.description, prompt: t.prompt };
  return (
    <AgentEditor
      factory={factory}
      factoryName={ctx.f.factory.name}
      name={null}
      title="New agent"
      initial={initial}
      defaults={ctx.defaults}
      runners={ctx.runners}
      runnerFiles={ctx.runnerFiles}
      routers={ctx.routers}
      secrets={ctx.secrets}
      mcps={ctx.mcps}
      workers={ctx.workers}
      automations={[]}
      otherAgents={otherAgents(ctx.f)}
      readOnly={ctx.readOnly}
      repo={ctx.repo}
      initialTab="settings"
    />
  );
}
