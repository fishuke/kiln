import type { Metadata } from "next";
import { Suspense } from "react";
import { AutoRefresh } from "@/components/kiln/auto-refresh";
import { ApiDown } from "@/components/kiln/ui";
import { buildInbox, type GateLike } from "@/lib/inbox-model";
import { api, safe } from "@/lib/kiln";
import type { GateView } from "@/lib/run-detail";
import { InboxView } from "./inbox-view";

export const metadata: Metadata = { title: "Inbox" };

export default async function InboxPage() {
  const [gates, items, factories, ready] = await Promise.all([safe(() => api.inbox({ all: true }), null), safe(() => api.workItems(), []), safe(() => api.factories(), []), safe(() => api.readyToMerge(), { items: [] })]);
  if (!gates) return <ApiDown />;
  const entries = buildInbox(gates as GateLike[], items);
  const views: Record<string, GateView> = {};
  for (const g of gates as GateLike[]) views[g.id] = { id: g.id, kind: g.kind, title: g.title, question: g.question, state: g.state, answer: g.answer, evidence: g.evidence, command: g.command, openedAt: g.openedAt, decidedAt: g.decidedAt, options: g.options, multiSelect: g.multiSelect };
  return (
    <>
      <AutoRefresh ms={8000} />
      <Suspense>
        <InboxView entries={entries} gates={views} factories={factories.map((f) => ({ id: f.id, name: f.name }))} ready={ready.items} />
      </Suspense>
    </>
  );
}
