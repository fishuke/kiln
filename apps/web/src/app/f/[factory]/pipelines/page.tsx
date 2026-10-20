import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { Empty, Page, PageHeader, Section } from "@/components/kiln/ui";
import { Badge } from "@/components/ui/badge";
import { api, safe } from "@/lib/kiln";
import { AreaTabs } from "../automations/_components/area-tabs";

type Stage = { id: string; agent?: string; action?: string; gate?: string; skip_if?: string; fan_out?: string; requires?: string[]; on_fail?: string; max_loops?: number; advisory?: boolean };

export default async function Pipelines({ params }: { params: Promise<{ factory: string }> }) {
  const { factory } = await params;
  const f = await safe(() => api.factory(factory), null);
  if (!f) notFound();
  const pipelines = Object.entries(f.pipelines) as [string, { stages: Stage[] }][];
  return (
    <>
      <PageHeader crumbs={[{ label: f.factory.name, href: `/f/${factory}/dashboard` }, { label: "Automations", href: `/f/${factory}/automations` }, { label: "Pipelines" }]} />
      <div className="px-4 pt-6 sm:px-6">
        <AreaTabs factory={factory} active="pipelines" />
      </div>
      <Page>
        <p className="mb-6 text-sm text-muted-foreground">
          Without a pipeline the foreman picks the shortest path: triage → spec (if needed, approved) → build → verify → preview → review → hand-off. A pipeline in <Link className="underline" href={`/f/${factory}/definition`}><code>pipelines/*.yaml</code></Link> fixes the graph with typed gates.
        </p>
        {pipelines.length === 0 && <Empty title="Foreman-driven">This factory has no pipeline; the foreman chooses the path for each work item.</Empty>}
        {pipelines.map(([name, p]) => (
          <Section key={name} title={name} description={f.definition.defaultPipeline === name ? "Default pipeline" : undefined}>
            <div className="flex flex-wrap items-stretch gap-2">
              {p.stages.map((s, i) => (
                <div key={s.id} className="flex items-center gap-2">
                  <div className="min-w-36 rounded-xl border bg-background p-3 text-sm">
                    <div className="font-medium">{s.id}</div>
                    <div className="text-xs text-muted-foreground">{s.agent ?? s.action}</div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {s.gate && <Badge>gate: {s.gate}</Badge>}
                      {s.fan_out && <Badge variant="secondary">{s.fan_out}</Badge>}
                      {s.advisory && <Badge variant="outline">advisory</Badge>}
                      {s.requires?.map((r) => (
                        <Badge key={r} variant="outline">{r}</Badge>
                      ))}
                    </div>
                    {s.skip_if && <div className="mt-2 font-mono text-[11px] text-muted-foreground">skip if {s.skip_if}</div>}
                    {s.on_fail && <div className="mt-1 font-mono text-[11px] text-muted-foreground">on fail → {s.on_fail} (max {s.max_loops ?? 3})</div>}
                  </div>
                  {i < p.stages.length - 1 && <ArrowRight className="size-4 text-muted-foreground" />}
                </div>
              ))}
            </div>
          </Section>
        ))}
        {Object.keys(f.gates).length > 0 && (
          <Section title="Gates">
            <ul className="space-y-1 text-sm">
              {Object.entries(f.gates).map(([n, g]) => (
                <li key={n}>
                  <span className="font-medium">{n}</span> <span className="text-muted-foreground">{JSON.stringify(g)}</span>
                </li>
              ))}
            </ul>
          </Section>
        )}
      </Page>
    </>
  );
}
