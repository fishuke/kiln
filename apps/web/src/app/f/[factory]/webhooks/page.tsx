import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Zap } from "lucide-react";
import { PageHeader } from "@/components/kiln/ui";
import { buttonVariants } from "@/components/ui/button";
import { loadResources } from "@/lib/api/resources";
import { listWebhooks, publicUrl } from "@/lib/api/webhooks";
import { api, safe } from "@/lib/kiln";
import { fileWebhooks, webhookUsage } from "@/lib/webhook-files";
import { AreaTabs } from "../automations/_components/area-tabs";
import { AddWebhook } from "./_components/add-webhook";
import { WebhookList, type WebhookRow } from "./_components/webhook-list";

export const metadata: Metadata = { title: "Webhooks" };

export default async function Webhooks({ params }: { params: Promise<{ factory: string }> }) {
  const { factory } = await params;
  const f = await safe(() => api.factory(factory), null);
  if (!f) notFound();
  const [hooks, def, origin, res] = await Promise.all([listWebhooks(factory), safe(() => api.definition(factory), null), publicUrl(), loadResources(factory, f)]);
  const tree = def?.tree ?? {};
  const usage = webhookUsage(tree);
  const fromApi = new Set(hooks.webhooks.map((w) => w.name));
  const rows: WebhookRow[] = [
    ...hooks.webhooks.map((w) => ({ uid: w.id, name: w.name, authMode: w.authMode, signatureScheme: w.signatureScheme, enabled: w.enabled, url: w.url, source: w.origin === "file" ? ("file" as const) : ("api" as const), automations: (usage[w.id] ?? 0) + (usage[w.name] ?? 0) })),
    ...fileWebhooks(tree)
      .filter((w) => !fromApi.has(w.name))
      .map((w) => ({ ...w, url: "", automations: usage[w.uid] ?? 0 })),
  ];
  const add = <AddWebhook factory={factory} secrets={res.secrets} origin={origin} />;
  return (
    <>
      <PageHeader crumbs={[{ label: f.factory.name, href: `/f/${factory}/dashboard` }, { label: "Automations", href: `/f/${factory}/automations` }, { label: "Webhooks" }]} actions={add} />
      <div className="px-4 py-4 sm:px-6">
        <AreaTabs factory={factory} active="webhooks" />
        <div className="mb-4 flex items-center gap-3 rounded-lg border bg-muted/50 px-4 py-3">
          <Zap className="size-4 shrink-0 self-start text-muted-foreground" />
          <div className="flex-1 text-sm">
            <p className="font-semibold">Webhooks need an automation to run anything</p>
            <p className="text-muted-foreground">A webhook only receives deliveries. To act on them, create an automation with a Webhook trigger that subscribes to it.</p>
          </div>
          <Link href={`/f/${factory}/automations/new`} className={buttonVariants({ variant: "outline" })}>
            Create automation
          </Link>
        </div>
        {!hooks.available && (
          <p className="mb-4 text-xs text-muted-foreground">
            This server does not manage webhooks through the API yet. New webhooks are added to the factory definition as <code className="font-mono">webhooks/&lt;name&gt;.yaml</code> and reference an existing secret.
          </p>
        )}
        <WebhookList factory={factory} rows={rows} addButton={add} />
      </div>
    </>
  );
}
