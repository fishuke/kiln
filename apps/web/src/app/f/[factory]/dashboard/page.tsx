import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/kiln/ui";
import { topPrCosts } from "@/lib/api/factory-admin";
import { apiRange, parseRange } from "@/lib/chart";
import { allPages, buildDashboard, withReportedPrs, type RunLite, type WorkItemLite } from "@/lib/dashboard-data";
import { agentDisplayName } from "@/lib/agent-catalog";
import { api, safe } from "@/lib/kiln";
import { DashboardTabs, DashboardView, RangeSelect, type ImprovementPr, type ScorerCard, type Tab } from "./dashboard-view";

export const metadata: Metadata = { title: "Dashboard" };

const SCORER_TIPS: Record<string, string> = {
  verbosity: "Whether the agent's written, text output was proportionate to the work.",
  "task-compliance": "Whether the agent fulfilled the mandate of its assigned factory role and did what the user or its orchestrating agent asked.",
  "procedure-compliance": "Whether the agent complied with the standing rules delivered through system context and invoked and followed through on the skills its situation called for.",
  efficiency: "Whether the agent worked directly toward its result, or wasted effort on redundant steps, avoidable rework, or unnecessary back-and-forth.",
  "code-quality": "Whether the code, tests, and comments the agent produced are well-designed and consistent with the target repo's conventions.",
};

export default async function Dashboard({ params, searchParams }: { params: Promise<{ factory: string }>; searchParams: Promise<{ tab?: string; range?: string; from?: string; to?: string }> }) {
  const { factory } = await params;
  const sp = await searchParams;
  const tab: Tab = sp.tab === "spending" || sp.tab === "scorers" ? sp.tab : "productivity";
  const range = parseRange(sp);
  const { startDate, endDate } = apiRange(range);
  const [f, runs, items, scores, si, top] = await Promise.all([
    safe(() => api.factory(factory), null),
    // The runs list pages at 500; the previous period feeds the KPI deltas.
    safe(() => allPages((cursor) => api.runsPage({ factory, limit: 500, cursor, createdAfter: range.prevStart.toISOString() }), (p) => p.runs), []),
    safe(() => api.workItems({ factory }), []),
    safe(() => api.scores(factory), []),
    safe(() => api.selfImprovement(factory), { proposals: [], failures: [] }),
    tab === "spending" ? topPrCosts(factory, startDate, endDate) : Promise.resolve(null),
  ]);
  if (!f) notFound();

  const data = buildDashboard({ runs: runs as unknown as RunLite[], items: items as unknown as WorkItemLite[], scores, range });
  // The per-PR cost report knows diffs and real sizes; prefer it when it is available.
  if (top?.length) data.topPrs = withReportedPrs(data.topPrs, top);

  const agentName = (name: string) => {
    const a = f.agents.find((x) => x.name === name);
    return a ? agentDisplayName(f.factory.name, a) : name;
  };
  const scorers: ScorerCard[] = Object.entries(f.scorers).map(([slug, s]) => ({
    slug,
    name: s.name ?? slug,
    description: SCORER_TIPS[slug] ?? s.rubric.split("\n").find((l) => l.trim() && !l.startsWith("#"))?.trim() ?? "",
    agents: (s.agents ?? []).map((a) => agentName(typeof a === "string" ? a : (a as { name: string }).name)),
  }));
  const improvements: ImprovementPr[] = si.proposals
    .filter((p) => p.target === "definition" || p.pr)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((p) => ({ id: p.id, agent: agentName(p.agent), category: p.category, state: p.state, url: p.pr?.url, title: p.pr ? `${p.pr.repo}#${p.pr.number} · ${p.category}` : `Improve ${p.agent}: ${p.category}`, createdAt: p.createdAt, passRateBefore: p.passRateBefore, passRateAfter: p.passRateAfter }));

  return (
    <>
      <PageHeader crumbs={[{ label: f.factory.name, href: `/f/${factory}/dashboard` }, { label: "Dashboard" }]} actions={<RangeSelect value={range.key} label={range.label} />} />
      <div className="space-y-4 px-6 pt-3 pb-10">
        <DashboardTabs tab={tab} />
        <DashboardView tab={tab} data={data} scorers={scorers} improvements={improvements} factory={factory} />
      </div>
    </>
  );
}
