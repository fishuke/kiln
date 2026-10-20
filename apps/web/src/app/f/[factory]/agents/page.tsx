import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AGENT_TYPES, agentDisplayName } from "@/lib/agent-catalog";
import { api, safe } from "@/lib/kiln";
import { filesApiAvailable } from "@/lib/api/factory-admin";
import { AgentsBoard, type AgentCard } from "./agents-board";

export const metadata: Metadata = { title: "Agents" };

export default async function Agents({ params }: { params: Promise<{ factory: string }> }) {
  const { factory } = await params;
  const f = await safe(() => api.factory(factory), null);
  if (!f) notFound();
  const readOnly = !!f.factory.definitionRepo && !(await filesApiAvailable(factory));
  const order = AGENT_TYPES as readonly string[];
  const agents: AgentCard[] = [...f.agents]
    .sort((a, b) => order.indexOf(a.agentType) - order.indexOf(b.agentType) || a.name.localeCompare(b.name))
    .map((a) => ({
      name: a.name,
      agentType: a.agentType,
      title: a.agentType === "FOREMAN" ? `${f.factory.alias} Foreman` : agentDisplayName(f.factory.name, a),
      description: a.description ?? "",
    }));
  return <AgentsBoard factory={factory} factoryName={f.factory.name} agents={agents} readOnly={readOnly} />;
}
