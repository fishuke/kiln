import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/kiln/ui";
import { getWebhook, ingressUrl, publicUrl, webhookDeliveries } from "@/lib/api/webhooks";
import { automationNames, automationPath, parseAutomation } from "@/lib/automations/model";
import { api, safe } from "@/lib/kiln";
import { fileWebhooks } from "@/lib/webhook-files";
import { WebhookDetail, type WebhookView } from "../_components/webhook-detail";

type Params = { params: Promise<{ factory: string; uid: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  return { title: `Webhooks — ${decodeURIComponent((await params).uid)}` };
}

export default async function WebhookPage({ params }: Params) {
  const { factory, uid: raw } = await params;
  const uid = decodeURIComponent(raw);
  const [f, def, origin] = await Promise.all([safe(() => api.factory(factory), null), safe(() => api.definition(factory), null), publicUrl()]);
  if (!f) notFound();
  const tree = def?.tree ?? {};
  const fromApi = await getWebhook(factory, uid);
  const fromFile = fileWebhooks(tree).find((w) => w.uid === uid);
  let view: WebhookView;
  if (fromApi) view = { ...fromApi, url: ingressUrl(fromApi, origin), source: fromApi.source ?? "api" };
  else if (fromFile) view = { ...fromFile, url: "" };
  else notFound();
  const deliveries = view.source === "api" ? await webhookDeliveries(factory, view.uid) : [];
  const automations = automationNames(tree).flatMap((name) => {
    try {
      const a = parseAutomation(name, tree[automationPath(tree, name)!]!);
      return a.triggers.some((t) => t.provider === "webhook" && (t.webhook === view.uid || t.webhook === view.name)) ? [{ name, title: a.displayName || name }] : [];
    } catch {
      return [];
    }
  });
  return (
    <>
      <PageHeader crumbs={[{ label: f.factory.name, href: `/f/${factory}/dashboard` }, { label: "Automations", href: `/f/${factory}/automations` }, { label: "Webhooks", href: `/f/${factory}/webhooks` }, { label: view.name }]} />
      <WebhookDetail factory={factory} webhook={view} deliveries={deliveries} automations={automations} />
    </>
  );
}
