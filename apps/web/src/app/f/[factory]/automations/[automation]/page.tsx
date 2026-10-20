import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { automationRuns } from "@/lib/api/automations";
import { automationPath, parseAutomation } from "@/lib/automations/model";
import { AutomationEditor } from "../_components/automation-editor";
import { loadEditorContext } from "../_components/load";

type Params = { params: Promise<{ factory: string; automation: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  return { title: `Automations — ${decodeURIComponent((await params).automation)}` };
}

export default async function AutomationDetail({ params }: Params) {
  const { factory, automation } = await params;
  const name = decodeURIComponent(automation);
  const [ctx, runs] = await Promise.all([loadEditorContext(factory), automationRuns(factory, name)]);
  if (!ctx) notFound();
  const path = automationPath(ctx.tree, name);
  let model;
  if (path) {
    try {
      model = parseAutomation(name, ctx.tree[path]!);
    } catch {
      model = undefined;
    }
  }
  if (!model) {
    // Fall back to the resolved definition (e.g. a file the editor cannot parse).
    const a = ctx.f.automations.find((x) => x.name === name);
    if (!a) notFound();
    model = parseAutomation(name, `---\n---\n${a.prompt}`);
    model.agent = a.agent;
    model.enabled = a.enabled;
    model.triggers = a.triggers.map((t) => ({ provider: t.provider, event: t.event, filters: {}, unknown: { ...(t.filter ?? {}) }, schedule: t.schedule }));
  }
  return (
    <AutomationEditor
      key={name}
      factory={factory}
      factoryName={ctx.f.factory.name}
      original={name}
      initial={model}
      resources={ctx.resources}
      webhooks={ctx.webhooks}
      connected={ctx.connected}
      alias={ctx.alias}
      repoBacked={ctx.repoBacked}
      runs={runs.map((r) => ({ id: r.id, href: `/runs/${r.workItemId ?? r.id}`, startedAt: r.startedAt, finishedAt: r.finishedAt, status: r.status, costUsd: r.costUsd, title: r.title }))}
    />
  );
}
