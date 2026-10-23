import Link from "next/link";
import { notFound } from "next/navigation";
import { planProject } from "@/app/actions";
import { SubmitButton } from "@/components/kiln/submit-button";
import { Page, PageHeader, Section, StateBadge } from "@/components/kiln/ui";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api, safe } from "@/lib/kiln";
import { Environments } from "@/components/kiln/environments";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = await safe(() => api.project(id), null);
  if (!p) notFound();
  const [layers, team, me] = await Promise.all([
    safe(() => api.variables("project", p.id), []),
    p.team ? safe(() => api.variables("team", p.team!), []) : Promise.resolve([]),
    safe(() => api.me(), null),
  ]);
  const canEdit = me?.role === "owner" || me?.role === "admin" || me?.subject === p.owner;
  return (
    <>
      <PageHeader crumbs={[{ label: "Projects", href: "/projects" }, { label: p.name }]} />
      <Page>
        <h1 className="text-2xl font-semibold">{p.name}</h1>
        <p className="mb-8 text-sm text-muted-foreground">
          Owner {p.owner} · factories {p.factories.join(", ")}
        </p>
        <Section
          title="Plan with the plan agent"
          description="A goal, a PRD or meeting notes become epics, milestones and tracker issues with acceptance criteria and a target factory."
        >
          <form action={planProject} className="space-y-2">
            <input type="hidden" name="projectId" value={p.id} />
            <input name="goal" required placeholder="Goal, e.g. Self-serve returns" className="h-9 w-full rounded-md border bg-background px-3 text-sm" />
            <textarea
              name="prd"
              rows={8}
              placeholder={"## Returns\n### Start a return from the order page\n  - AC: a Return button appears on delivered orders [shop]"}
              className="w-full rounded-md border bg-background p-3 font-mono text-xs"
            />
            <SubmitButton>Create roadmap and issues</SubmitButton>
          </form>
        </Section>
        <Section
          title="Environments"
          description="Variables and secrets for this project's factories and Studio apps. They override the team's variables; a factory or app can override them."
        >
          <Environments scope="project" owner={p.id} layers={layers} inherited={[{ from: "team", layers: team }]} canEdit={canEdit} />
        </Section>
        {p.roadmap && (
          <Section title={`Roadmap: ${p.roadmap.goal}`}>
            <div className="space-y-4">
              {p.roadmap.epics.map((e) => (
                <Card key={e.id}>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Badge variant="outline">{e.milestone}</Badge> {e.title}
                      {e.url && (
                        <a href={e.url} className="ml-auto text-xs font-normal underline" target="_blank" rel="noreferrer">
                          {e.trackerKey}
                        </a>
                      )}
                    </CardTitle>
                    {e.dependsOn.length > 0 && <p className="text-xs text-muted-foreground">Depends on {e.dependsOn.join(", ")}</p>}
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-2 text-sm">
                      {e.issues.map((i) => (
                        <li key={i.title} className="rounded-md border p-2">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{i.title}</span>
                            <Badge variant="secondary">@{i.factory}</Badge>
                            {i.url && (
                              <a href={i.url} className="ml-auto text-xs underline" target="_blank" rel="noreferrer">
                                {i.trackerKey}
                              </a>
                            )}
                          </div>
                          <ul className="mt-1 list-disc pl-5 text-xs text-muted-foreground">
                            {i.criteria.map((c) => (
                              <li key={c}>{c}</li>
                            ))}
                          </ul>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              ))}
            </div>
          </Section>
        )}
        <Section title="Work items">
          <ul className="divide-y rounded-xl border">
            {p.workItems.map((w) => (
              <li key={w.id}>
                <Link href={`/runs/${w.id}`} className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-muted/50">
                  <span className="truncate">{w.title}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{w.factory}</span>
                  <StateBadge state={w.state} />
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      </Page>
    </>
  );
}
