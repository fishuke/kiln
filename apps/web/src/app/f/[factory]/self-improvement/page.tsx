import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { api, safe } from "@/lib/kiln";
import { ImprovementView } from "./_components/improvement-view";

export const metadata: Metadata = { title: "Self-improvement" };

const REVIEWERS: Record<string, string> = { admins: "factory admins", team: "the team", custom: "custom list", none: "no reviewer" };

export default async function SelfImprovement({ params }: { params: Promise<{ factory: string }> }) {
  const { factory } = await params;
  const [f, si] = await Promise.all([safe(() => api.factory(factory), null), safe(() => api.selfImprovement(factory), { proposals: [], failures: [] })]);
  if (!f) notFound();
  const cfg = (f.definition.selfImprovement ?? {}) as { failedRunThreshold?: number; maxAgeDays?: number; reviewers?: { type?: string; emails?: string[] } };
  const byAgent = new Map<string, { agent: string; count: number; oldest: string }>();
  for (const s of si.failures) {
    const row = byAgent.get(s.agent) ?? { agent: s.agent, count: 0, oldest: s.createdAt };
    row.count++;
    if (s.createdAt < row.oldest) row.oldest = s.createdAt;
    byAgent.set(s.agent, row);
  }
  const reviewers = cfg.reviewers?.type === "custom" && cfg.reviewers.emails?.length ? cfg.reviewers.emails.join(", ") : REVIEWERS[cfg.reviewers?.type ?? "admins"] ?? "factory admins";
  return (
    <ImprovementView
      factory={factory}
      factoryName={f.factory.name}
      proposals={[...si.proposals].sort((a, b) => (a.state === "open" ? 0 : 1) - (b.state === "open" ? 0 : 1) || b.createdAt.localeCompare(a.createdAt))}
      failures={[...byAgent.values()]}
      settings={{
        threshold: cfg.failedRunThreshold ?? 25,
        maxAgeDays: cfg.maxAgeDays ?? 7,
        reviewers,
        enabledScorers: Object.values(f.scorers)
          .filter((s) => s.selfImprovement)
          .map((s) => s.name),
      }}
    />
  );
}
