import { notFound } from "next/navigation";
import { Empty, Page, PageHeader } from "@/components/kiln/ui";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api, safe } from "@/lib/kiln";

export default async function Automations({ params }: { params: Promise<{ factory: string }> }) {
  const { factory } = await params;
  const f = await safe(() => api.factory(factory), null);
  if (!f) notFound();
  return (
    <>
      <PageHeader crumbs={[{ label: f.factory.name, href: `/f/${factory}` }, { label: "Automations" }]} />
      <Page>
        <p className="mb-6 text-sm text-muted-foreground">Triggers that start work: provider events, schedules and signed webhooks. Defined in <code>automations/&lt;name&gt;/automation.md</code>.</p>
        {f.automations.length === 0 && <Empty title="No automations">Mentions of @{f.factory.alias} still reach the foreman.</Empty>}
        <div className="space-y-3">
          {f.automations.map((a) => (
            <Card key={a.name} size="sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  {a.name}
                  <Badge variant={a.enabled ? "secondary" : "outline"}>{a.enabled ? "On" : "Off"}</Badge>
                  <span className="ml-auto text-xs font-normal text-muted-foreground">→ {a.agent}</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <ul className="space-y-1">
                  {a.triggers.map((t, i) => (
                    <li key={i} className="flex flex-wrap items-center gap-2 text-xs">
                      <Badge variant="outline">{t.provider}</Badge>
                      <span className="font-mono">{t.event}</span>
                      {t.schedule && <span className="font-mono text-muted-foreground">cron {t.schedule.cron}</span>}
                      {t.filter && <span className="font-mono text-muted-foreground">{JSON.stringify(t.filter)}</span>}
                    </li>
                  ))}
                </ul>
                {a.prompt && <p className="text-muted-foreground">{a.prompt}</p>}
              </CardContent>
            </Card>
          ))}
        </div>
      </Page>
    </>
  );
}
