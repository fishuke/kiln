import { notFound } from "next/navigation";
import { Page, PageHeader, Pre } from "@/components/kiln/ui";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { api, safe } from "@/lib/kiln";

export default async function Agents({ params }: { params: Promise<{ factory: string }> }) {
  const { factory } = await params;
  const f = await safe(() => api.factory(factory), null);
  if (!f) notFound();
  const order = ["FOREMAN", "TRIAGE", "SPEC", "IMPLEMENT", "VERIFY", "REVIEW", "PLAN", "PO_ASSISTANT", "CUSTOM"];
  const agents = [...f.agents].sort((a, b) => order.indexOf(a.agentType) - order.indexOf(b.agentType));
  return (
    <>
      <PageHeader crumbs={[{ label: f.factory.name, href: `/f/${factory}` }, { label: "Agents" }]} />
      <Page>
        <p className="mb-6 text-sm text-muted-foreground">
          In a factory you talk to the foreman (<code>@{f.factory.alias}</code>); it delegates to agents for triage, specs, code, verification and review. Agents are defined in <code>agents/&lt;name&gt;/agent.md</code>.
        </p>
        <div className="grid gap-4 md:grid-cols-2">
          {agents.map((a) => (
            <Card key={a.name}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  {a.name}
                  <Badge variant="secondary">{a.agentType}</Badge>
                </CardTitle>
                <CardDescription>{a.description ?? "—"}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <dl className="grid grid-cols-[90px_1fr] gap-y-1 text-xs">
                  <dt className="text-muted-foreground">Harness</dt>
                  <dd>
                    {a.harness.type}
                    {a.harness.model ? ` · ${a.harness.model}` : ""}
                  </dd>
                  <dt className="text-muted-foreground">Runner</dt>
                  <dd>{a.runner ?? "default"}</dd>
                  <dt className="text-muted-foreground">Skills</dt>
                  <dd>{a.skills.join(", ") || "—"}</dd>
                </dl>
                <details>
                  <summary className="cursor-pointer text-xs text-muted-foreground">Instructions</summary>
                  <Pre className="mt-2 max-h-80">{a.instructions}</Pre>
                </details>
              </CardContent>
            </Card>
          ))}
        </div>
      </Page>
    </>
  );
}
