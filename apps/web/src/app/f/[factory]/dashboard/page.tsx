import Link from "next/link";
import { notFound } from "next/navigation";
import { canary } from "@/app/actions";
import { AutoRefresh } from "@/components/kiln/auto-refresh";
import { SubmitButton } from "@/components/kiln/submit-button";
import { Page, PageHeader, Section, Stat, StateBadge } from "@/components/kiln/ui";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, safe } from "@/lib/kiln";
import { greeting, pct, timeAgo, usd } from "@/lib/format";

export default async function Dashboard({ params, searchParams }: { params: Promise<{ factory: string }>; searchParams: Promise<{ days?: string }> }) {
  const { factory } = await params;
  const days = Number((await searchParams).days ?? 30);
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const [f, m, items, me] = await Promise.all([safe(() => api.factory(factory), null), safe(() => api.metrics(factory, { since }), null), safe(() => api.workItems({ factory }), []), safe(() => api.me(), undefined)]);
  if (!f || !m) notFound();
  const name = me?.subject.split("@")[0] ?? "there";
  return (
    <>
      <PageHeader
        crumbs={[{ label: f.factory.name }, { label: "Dashboard" }]}
        actions={[7, 30, 90].map((d) => (
          <Link key={d} href={`?days=${d}`} className={`rounded-md px-2 py-1 text-sm ${d === days ? "bg-muted font-medium" : "text-muted-foreground"}`}>
            {d}d
          </Link>
        ))}
      />
      <AutoRefresh ms={8000} />
      <Page>
        <p className="text-sm text-muted-foreground">{greeting()},</p>
        <h1 className="mb-6 text-2xl font-semibold tracking-tight">{name}</h1>
        <h2 className="mb-3 text-base font-semibold">Your overview</h2>
        <div className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Autonomy" value={pct(m.autonomy)} hint={`${m.autonomousMerged} of ${m.prsMerged} merged PRs needed no human touch beyond the request`} />
          <Stat label="Merged PRs" value={m.prsMerged} hint="From this factory" />
          <Stat label="Cost per PR" value={usd(m.costPerMergedPrUsd)} hint={`${usd(m.costUsd)} total`} />
          <Stat label="PRs opened" value={m.prsOpened} hint={`Median cycle time ${m.cycleTimeHoursMedian ?? "—"}h`} />
        </div>

        {f.factory.canary && (
          <div className="mb-8 flex items-center gap-4 rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm dark:bg-violet-950/30">
            <div className="flex-1">
              A canary definition <code>{f.factory.canary.sha.slice(0, 10)}</code> gets {f.factory.canary.percent}% of new work items since {timeAgo(f.factory.canary.since)}.
            </div>
            <form action={canary} className="flex gap-2">
              <input type="hidden" name="factory" value={factory} />
              <SubmitButton name="action" value="promote" size="sm">Promote</SubmitButton>
              <SubmitButton name="action" value="rollback" size="sm" variant="outline">Roll back</SubmitButton>
            </form>
          </div>
        )}

        <div className="grid gap-8 lg:grid-cols-2">
          <Section title="Agents" description="Cost and scores per agent">
            <div className="rounded-xl border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Agent</TableHead>
                    <TableHead className="text-right">Runs</TableHead>
                    <TableHead className="text-right">Cost / merged PR</TableHead>
                    <TableHead className="text-right">Pass rate</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {m.byAgent.map((a) => (
                    <TableRow key={a.agent}>
                      <TableCell className="font-medium">{a.agent}</TableCell>
                      <TableCell className="text-right tabular-nums">{a.runs}</TableCell>
                      <TableCell className="text-right tabular-nums">{usd(a.costPerMergedPrUsd)}</TableCell>
                      <TableCell className="text-right tabular-nums">{a.scored ? pct(a.passRate) : "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Section>
          <Section title="Work" description={`${m.workItems.active} active · ${m.workItems.blocked} blocked · ${m.workItems.complete} complete`}>
            <ul className="divide-y rounded-xl border">
              {items.slice(0, 8).map((w) => (
                <li key={w.id}>
                  <Link href={`/runs/${w.id}`} className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-muted/50">
                    <span className="truncate">{w.title}</span>
                    <span className="ml-auto shrink-0 text-xs text-muted-foreground">{timeAgo(w.updatedAt)}</span>
                    <StateBadge state={w.state} />
                  </Link>
                </li>
              ))}
            </ul>
          </Section>
        </div>
        {m.byDefinition.length > 1 && (
          <Section title="By definition" description="Canary split: metrics per definition sha">
            <div className="rounded-xl border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Definition</TableHead>
                    <TableHead className="text-right">Work items</TableHead>
                    <TableHead className="text-right">Pass rate</TableHead>
                    <TableHead className="text-right">Cost</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {m.byDefinition.map((d) => (
                    <TableRow key={d.sha}>
                      <TableCell className="font-mono text-xs">{d.sha.slice(0, 12)}{d.sha === f.factory.canary?.sha ? " (canary)" : d.sha === f.factory.appliedSha ? " (applied)" : ""}</TableCell>
                      <TableCell className="text-right">{d.workItems}</TableCell>
                      <TableCell className="text-right">{pct(d.passRate)}</TableCell>
                      <TableCell className="text-right">{usd(d.costUsd)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Section>
        )}
      </Page>
    </>
  );
}
