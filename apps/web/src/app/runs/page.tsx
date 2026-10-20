import type { Metadata } from "next";
import { Suspense } from "react";
import { AutoRefresh } from "@/components/kiln/auto-refresh";
import { ApiDown } from "@/components/kiln/ui";
import { api, safe } from "@/lib/kiln";
import { buildRunRows, flatten } from "@/lib/run-tree";
import { RunsLoading, RunsView } from "./runs-view";
import type { SetupTask } from "./setup-panel";

export const metadata: Metadata = { title: "Runs" };

export default async function RunsPage() {
  const [items, runs, me, factories, integrations] = await Promise.all([
    safe(() => api.workItems(), null),
    safe(() => api.runs({ limit: 500 }), []),
    safe(() => api.me(), undefined),
    safe(() => api.factories(), []),
    safe(() => api.integrations(), undefined),
  ]);
  if (!items) return <ApiDown />;
  const rows = buildRunRows(items, runs);
  const live = flatten(rows).some((r) => r.status === "running");
  const first = factories[0];
  const detail = first ? await safe(() => api.factory(first.id), undefined) : undefined;
  const chatConnected = Boolean(integrations && !["fake", "none", "log", ""].includes(integrations.chat));
  const fromBacklog = items.some((w) => ["linear", "jira", "github"].includes(w.source.provider));
  const base = first ? `/f/${first.id}` : "/create";
  const setup: SetupTask[] = [
    { id: "integrations", icon: "route", title: "Connect integrations", body: "Connect Slack or Microsoft Teams to bring issues into your factory.", href: "/integrations", done: chatConnected },
    { id: "backlog", icon: "archive", title: "Assign factory agents to your backlog", body: "Get your factory to start working on your real tasks.", href: `${base}/automations`, done: fromBacklog },
    { id: "learn", icon: "brain", title: "Let your factory learn how you work", body: "Your factory will research your team’s tools and workflows to improve its agents. Uses model credits.", href: `${base}/self-improvement`, done: false },
    { id: "automation", icon: "archive", title: "Create an automation", body: "Run an agent on a schedule or when something happens.", href: `${base}/automations/new`, done: Boolean(detail?.automations.length) },
  ];
  return (
    <>
      <AutoRefresh enabled={live} ms={4000} />
      <Suspense fallback={<RunsLoading />}>
        <RunsView rows={rows} me={me?.subject ?? ""} factories={factories.map((f) => ({ id: f.id, name: f.name, alias: f.alias }))} setup={setup} />
      </Suspense>
    </>
  );
}
