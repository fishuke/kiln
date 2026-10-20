import Link from "next/link";
import { createProject } from "@/app/actions";
import { SubmitButton } from "@/components/kiln/submit-button";
import { ApiDown, Empty, Page, PageHeader, Section, Stat } from "@/components/kiln/ui";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, safe } from "@/lib/kiln";
import { usd } from "@/lib/format";

export default async function Projects() {
  const [portfolio, factories] = await Promise.all([safe(() => api.portfolio(), null), safe(() => api.factories(), [])]);
  if (!portfolio) return <ApiDown />;
  return (
    <>
      <PageHeader crumbs={[{ label: "Projects" }]} />
      <Page>
        <div className="mb-8 grid gap-3 sm:grid-cols-4">
          <Stat label="Factories" value={portfolio.totals.factories} />
          <Stat label="Merged PRs (30d)" value={portfolio.totals.prsMerged} />
          <Stat label="Active work" value={portfolio.totals.activeWorkItems} />
          <Stat label="Spend (30d)" value={usd(portfolio.totals.costUsd)} />
        </div>
        <Section title="Portfolio" description="Work, cost and decisions rolled up across each project's factories.">
          {portfolio.projects.length === 0 ? (
            <Empty title="No projects yet" />
          ) : (
            <div className="rounded-xl border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Project</TableHead>
                    <TableHead>Factories</TableHead>
                    <TableHead className="text-right">Active</TableHead>
                    <TableHead className="text-right">PRs opened</TableHead>
                    <TableHead className="text-right">Merged</TableHead>
                    <TableHead className="text-right">Waiting on people</TableHead>
                    <TableHead className="text-right">Cost</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {portfolio.projects.map(({ project, totals }) => (
                    <TableRow key={project.id}>
                      <TableCell>
                        <Link href={`/projects/${project.id}`} className="font-medium hover:underline">
                          {project.name}
                        </Link>
                        <div className="text-xs text-muted-foreground">{project.owner}</div>
                      </TableCell>
                      <TableCell>{project.factories.join(", ")}</TableCell>
                      <TableCell className="text-right">{totals.activeWorkItems}</TableCell>
                      <TableCell className="text-right">{totals.prsOpened}</TableCell>
                      <TableCell className="text-right">{totals.prsMerged}</TableCell>
                      <TableCell className="text-right">{totals.pendingDecisions}</TableCell>
                      <TableCell className="text-right">{usd(totals.costUsd)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </Section>
        <Section title="New project">
          <form action={createProject} className="space-y-3 rounded-xl border p-4 text-sm">
            <input name="name" required placeholder="Project name" className="h-9 w-full rounded-md border bg-background px-3" />
            <div className="flex flex-wrap gap-3">
              {factories.map((f) => (
                <label key={f.id} className="flex items-center gap-1.5">
                  <input type="checkbox" name="factories" value={f.id} /> {f.name}
                </label>
              ))}
            </div>
            <SubmitButton>Create project</SubmitButton>
          </form>
        </Section>
      </Page>
    </>
  );
}
