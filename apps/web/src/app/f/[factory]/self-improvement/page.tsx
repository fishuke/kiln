import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { proposal, runSelfImprovement } from "@/app/actions";
import { SubmitButton } from "@/components/kiln/submit-button";
import { Empty, Page, PageHeader, Pre, Section } from "@/components/kiln/ui";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api, safe } from "@/lib/kiln";
import { pct, timeAgo } from "@/lib/format";

export default async function SelfImprovement({ params }: { params: Promise<{ factory: string }> }) {
  const { factory } = await params;
  const [f, si] = await Promise.all([safe(() => api.factory(factory), null), safe(() => api.selfImprovement(factory), null)]);
  if (!f || !si) notFound();
  const threshold = (f.definition.selfImprovement as { failedRunThreshold?: number } | undefined)?.failedRunThreshold ?? 25;
  const byAgent = Object.entries(si.failures.reduce<Record<string, number>>((acc, s) => ({ ...acc, [s.agent]: (acc[s.agent] ?? 0) + 1 }), {}));
  return (
    <>
      <PageHeader
        crumbs={[{ label: f.factory.name, href: `/f/${factory}` }, { label: "Self-improvement" }]}
        actions={
          <form action={runSelfImprovement}>
            <input type="hidden" name="factory" value={factory} />
            <SubmitButton size="sm">Run now</SubmitButton>
          </form>
        }
      />
      <Page>
        <p className="mb-6 text-sm text-muted-foreground">
          Failures from scorers with self-improvement on accumulate per agent. At {threshold} distinct unreviewed failures, or when the oldest is 7 days old, an improver proposes a fix, replays the failing runs under it, and opens a pull request. Nothing is adopted without review; accepted changes ship as a 10% canary.
        </p>
        <Section title="Unreviewed failures">
          {byAgent.length === 0 ? (
            <Empty title="No unreviewed failures" />
          ) : (
            <div className="flex flex-wrap gap-3">
              {byAgent.map(([agent, n]) => (
                <Card key={agent} size="sm" className="min-w-48">
                  <CardContent>
                    <div className="text-sm text-muted-foreground">{agent}</div>
                    <div className="text-2xl font-semibold">
                      {n}
                      <span className="text-sm font-normal text-muted-foreground"> / {threshold}</span>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </Section>
        <Section title="Proposals">
          {si.proposals.length === 0 && <Empty title="No proposals yet" />}
          <div className="space-y-4">
            {si.proposals.map((p) => (
              <Card key={p.id}>
                <CardHeader>
                  <CardTitle className="flex flex-wrap items-center gap-2">
                    {p.agent} · {p.category}
                    <Badge variant={p.state === "open" ? "default" : p.state === "merged" ? "secondary" : "outline"}>{p.state}</Badge>
                    {p.needsTwoApprovals && <Badge variant="outline">needs 2 approvals ({p.approvals?.length ?? 0}/2)</Badge>}
                    <span className="ml-auto text-xs font-normal text-muted-foreground">{timeAgo(p.createdAt)}</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <p>{p.rationale}</p>
                  <div className="flex gap-6">
                    <div>
                      Replay pass rate <span className="font-semibold">{pct(p.passRateBefore)}</span> → <span className="font-semibold text-emerald-700">{pct(p.passRateAfter)}</span>
                    </div>
                    <div className="text-muted-foreground">{p.replay.length} runs replayed</div>
                    {p.pr && (
                      <a href={p.pr.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline">
                        PR #{p.pr.number} <ExternalLink className="size-3" />
                      </a>
                    )}
                  </div>
                  {p.droppedProtectedPaths.length > 0 && <p className="text-amber-700">Dropped changes to protected paths: {p.droppedProtectedPaths.join(", ")}</p>}
                  <details>
                    <summary className="cursor-pointer text-muted-foreground">Regressions addressed and replay</summary>
                    <Pre className="mt-2">{p.body}</Pre>
                  </details>
                  <ul className="flex flex-wrap gap-2 text-xs">
                    {p.failures.map((x) => (
                      <li key={x.scoreId}>
                        <Link className="underline" href={`/agent-runs/${x.runId}`}>
                          {x.runId}
                        </Link>{" "}
                        ({x.label})
                      </li>
                    ))}
                  </ul>
                  {p.state === "open" && (
                    <form action={proposal} className="flex gap-2">
                      <input type="hidden" name="proposalId" value={p.id} />
                      <SubmitButton name="action" value="approve" size="sm">Approve as canary</SubmitButton>
                      <input name="reason" placeholder="Reason (kept as a negative example)" className="h-7 flex-1 rounded-md border bg-background px-2 text-xs" />
                      <SubmitButton name="action" value="reject" size="sm" variant="outline">Reject</SubmitButton>
                    </form>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </Section>
      </Page>
    </>
  );
}
