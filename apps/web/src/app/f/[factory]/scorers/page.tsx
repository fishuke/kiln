import { notFound } from "next/navigation";
import { Empty, Page, PageHeader } from "@/components/kiln/ui";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api, safe } from "@/lib/kiln";
import { pct } from "@/lib/format";

export default async function Scorers({ params }: { params: Promise<{ factory: string }> }) {
  const { factory } = await params;
  const [f, scores] = await Promise.all([safe(() => api.factory(factory), null), safe(() => api.scores(factory), [])]);
  if (!f) notFound();
  const scorers = Object.entries(f.scorers);
  return (
    <>
      <PageHeader crumbs={[{ label: f.factory.name, href: `/f/${factory}` }, { label: "Scorers" }]} />
      <Page>
        <p className="mb-6 text-sm text-muted-foreground">Judges that grade sampled runs. Scorers with self-improvement on feed failures into improvement proposals.</p>
        {scorers.length === 0 && <Empty title="No scorers">Add one in scorers/&lt;name&gt;/scorer.md.</Empty>}
        <div className="grid gap-4 md:grid-cols-2">
          {scorers.map(([key, s]) => {
            const mine = scores.filter((x) => x.scorer === s.name);
            const passed = mine.filter((x) => x.passed).length;
            return (
              <Card key={key}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    {s.name}
                    {s.selfImprovement && <Badge>self-improvement</Badge>}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <p className="text-muted-foreground">{s.rubric}</p>
                  <div className="flex flex-wrap gap-1">
                    {s.labels.map((l) => (
                      <Badge key={l.value} variant={l.score >= s.passingScore ? "secondary" : "outline"}>
                        {l.value} · {l.score}
                      </Badge>
                    ))}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Grades {s.agents.join(", ")} · samples {s.samplingRate}% · judge {s.model} · passing ≥ {s.passingScore}
                  </div>
                  <div className="text-sm">
                    {mine.length} scored · pass rate {mine.length ? pct(passed / mine.length) : "—"}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </Page>
    </>
  );
}
