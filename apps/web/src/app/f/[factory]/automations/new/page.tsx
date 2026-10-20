import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { automationTemplates } from "@/lib/api/automations";
import { parseTrigger, type AutomationModel } from "@/lib/automations/model";
import { AutomationEditor } from "../_components/automation-editor";
import { loadEditorContext } from "../_components/load";

export const metadata: Metadata = { title: "New Automation" };

export default async function NewAutomation({ params, searchParams }: { params: Promise<{ factory: string }>; searchParams: Promise<{ suggestion?: string; variant?: string }> }) {
  const { factory } = await params;
  const { suggestion } = await searchParams;
  const [ctx, templates] = await Promise.all([loadEditorContext(factory), suggestion ? automationTemplates() : Promise.resolve([])]);
  if (!ctx) notFound();
  const t = suggestion ? templates.find((x) => x.slug === suggestion) : undefined;
  const agent = t?.agentType ? ctx.resources.agents.find((a) => a.agentType === t.agentType)?.name : undefined;
  const foreman = ctx.resources.agents.find((a) => a.agentType === "FOREMAN")?.name;
  const initial: AutomationModel = {
    name: t?.title ?? "",
    enabled: true,
    agent: agent && agent !== foreman ? agent : undefined,
    prompt: t?.prompt ?? "",
    triggers: (t?.triggers ?? []).map((x) => parseTrigger(x as Record<string, unknown>)),
    overrides: {},
    extra: {},
  };
  return (
    <AutomationEditor
      key={suggestion ?? "new"}
      factory={factory}
      factoryName={ctx.f.factory.name}
      original={null}
      initial={initial}
      prefilled={Boolean(t)}
      resources={ctx.resources}
      webhooks={ctx.webhooks}
      connected={ctx.connected}
      alias={ctx.alias}
      repoBacked={ctx.repoBacked}
      runs={[]}
    />
  );
}
