import { notFound } from "next/navigation";
import { proposeRouter, runBenchmark } from "@/app/actions";
import { SubmitButton } from "@/components/kiln/submit-button";
import { Empty, Page, PageHeader, Section } from "@/components/kiln/ui";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, safe } from "@/lib/kiln";
import { pct, usd } from "@/lib/format";
import type { ConfigSummary } from "@kiln/sdk-ts";

/** Cost (x) against success rate (y); Pareto-optimal configurations are filled. */
function Pareto({ rows }: { rows: ConfigSummary[] }) {
  const W = 420;
  const H = 220;
  const pad = 36;
  const maxCost = Math.max(...rows.map((r) => r.avgCostUsd), 0.0001);
  const x = (c: number) => pad + (c / maxCost) * (W - pad * 2);
  const y = (s: number) => H - pad - s * (H - pad * 2);
  const front = rows.filter((r) => r.pareto).sort((a, b) => a.avgCostUsd - b.avgCostUsd);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-xl" role="img" aria-label="Cost versus success rate">
      <line x1={pad} y1={H - pad} x2={W - pad} y2={H - pad} className="stroke-border" />
      <line x1={pad} y1={pad} x2={pad} y2={H - pad} className="stroke-border" />
      <text x={W / 2} y={H - 6} textAnchor="middle" className="fill-muted-foreground text-[10px]">
        average cost per task
      </text>
      <text x={10} y={H / 2} textAnchor="middle" transform={`rotate(-90 10 ${H / 2})`} className="fill-muted-foreground text-[10px]">
        success rate
      </text>
      {front.length > 1 && <polyline points={front.map((r) => `${x(r.avgCostUsd)},${y(r.successRate)}`).join(" ")} className="fill-none stroke-foreground/40" strokeDasharray="4 3" />}
      {rows.map((r) => (
        <g key={r.configuration}>
          <circle cx={x(r.avgCostUsd)} cy={y(r.successRate)} r={6} className={r.pareto ? "fill-foreground" : "fill-background stroke-foreground"} />
          <text x={x(r.avgCostUsd) + 9} y={y(r.successRate) + 4} className="fill-foreground text-[11px]">
            {r.configuration}
          </text>
        </g>
      ))}
    </svg>
  );
}

export default async function Benchmarks({ params }: { params: Promise<{ factory: string }> }) {
  const { factory } = await params;
  const [f, b] = await Promise.all([safe(() => api.factory(factory), null), safe(() => api.benchmarks(factory), null)]);
  if (!f || !b) notFound();
  return (
    <>
      <PageHeader crumbs={[{ label: f.factory.name, href: `/f/${factory}` }, { label: "Benchmarks" }]} />
      <Page>
        <p className="mb-6 text-sm text-muted-foreground">
          Suites of tasks pinned to exact commits, run under up to six configurations. Save any finished run as a task from its run page. Suites are costly: run them when models or skills change.
        </p>
        {b.suites.length === 0 && <Empty title="No benchmark suites">Add one in benchmarks/&lt;suite&gt;/suite.yaml with tasks/*.yaml.</Empty>}
        {b.suites.map((suite) => {
          const rows = b.summary[suite] ?? [];
          return (
            <Section
              key={suite}
              title={suite}
              description={`${f.benchmarks[suite]?.tasks.length ?? 0} tasks · ${f.benchmarks[suite]?.configurations.length ?? 0} configurations`}
              action={
                <div className="flex gap-2">
                  <form action={runBenchmark}>
                    <input type="hidden" name="factory" value={factory} />
                    <input type="hidden" name="suite" value={suite} />
                    <SubmitButton size="sm">Run suite</SubmitButton>
                  </form>
                  {rows.length > 0 && (
                    <form action={proposeRouter}>
                      <input type="hidden" name="factory" value={factory} />
                      <input type="hidden" name="suite" value={suite} />
                      <SubmitButton size="sm" variant="outline">Suggest routing</SubmitButton>
                    </form>
                  )}
                </div>
              }
            >
              {rows.length === 0 ? (
                <Empty title="Not run yet" />
              ) : (
                <div className="grid gap-6 lg:grid-cols-2">
                  <Pareto rows={rows} />
                  <div className="rounded-xl border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Configuration</TableHead>
                          <TableHead className="text-right">Success</TableHead>
                          <TableHead className="text-right">Avg cost</TableHead>
                          <TableHead className="text-right">Pareto</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {rows.map((r) => (
                          <TableRow key={r.configuration}>
                            <TableCell className="font-medium">{r.configuration}</TableCell>
                            <TableCell className="text-right">{pct(r.successRate)}</TableCell>
                            <TableCell className="text-right">{usd(r.avgCostUsd)}</TableCell>
                            <TableCell className="text-right">{r.pareto ? "●" : ""}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}
            </Section>
          );
        })}
      </Page>
    </>
  );
}
