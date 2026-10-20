import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { agentFormFromSource, agentPath, emptyAgentForm } from "@/lib/agent-file";
import { agentDisplayName } from "@/lib/agent-catalog";
import { AgentEditor } from "./agent-editor";
import { automationsFor, loadAgentContext, otherAgents } from "./load";

export async function generateMetadata({ params }: { params: Promise<{ agent: string }> }): Promise<Metadata> {
  const { agent } = await params;
  return { title: `Agents — ${agent}` };
}

export default async function AgentPage({ params, searchParams }: { params: Promise<{ factory: string; agent: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { factory, agent } = await params;
  const { tab } = await searchParams;
  const ctx = await loadAgentContext(factory);
  if (!ctx) notFound();
  const resolved = ctx.f.agents.find((a) => a.name === agent);
  const source = ctx.tree[agentPath(agent)];
  if (!resolved && source === undefined) notFound();
  const initial = source !== undefined ? agentFormFromSource(source) : { ...emptyAgentForm(resolved!.agentType), description: resolved!.description ?? "", prompt: resolved!.instructions };
  const title = agentDisplayName(ctx.f.factory.name, { name: agent, agentType: initial.agentType });
  return (
    <AgentEditor
      key={agent}
      factory={factory}
      factoryName={ctx.f.factory.name}
      name={agent}
      title={title}
      initial={initial}
      defaults={ctx.defaults}
      runners={ctx.runners}
      runnerFiles={ctx.runnerFiles}
      routers={ctx.routers}
      secrets={ctx.secrets}
      mcps={ctx.mcps}
      workers={ctx.workers}
      automations={automationsFor(ctx.f, agent, initial.agentType)}
      otherAgents={otherAgents(ctx.f, agent)}
      readOnly={ctx.readOnly}
      repo={ctx.repo}
      initialTab={tab === "prompt" || tab === "automations" ? tab : "settings"}
    />
  );
}
