import { installSkill, publishSkill } from "@/app/actions";
import { SubmitButton } from "@/components/kiln/submit-button";
import { ApiDown, Empty, Page, PageHeader, Section } from "@/components/kiln/ui";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api, safe } from "@/lib/kiln";

export default async function Skills() {
  const [skills, factories] = await Promise.all([safe(() => api.skills(), null), safe(() => api.factories(), [])]);
  if (!skills) return <ApiDown />;
  return (
    <>
      <PageHeader crumbs={[{ label: "Skills" }]} />
      <Page>
        <p className="mb-6 text-sm text-muted-foreground">The org-wide catalog. Skills are SKILL.md folders in factory definitions; publishing one lets other factories install it, which opens a PR to their config repo (or applies it to a Kiln-managed factory).</p>
        {skills.catalog.length === 0 && <Empty title="No skills yet" />}
        <div className="grid gap-4 md:grid-cols-2">
          {skills.catalog.map((s) => (
            <Card key={`${s.name}-${s.listingId ?? s.factories[0]}`}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  {s.name}
                  <Badge variant="outline">v{s.version}</Badge>
                  {s.listingId && <Badge>published</Badge>}
                  <span className="ml-auto text-xs font-normal text-muted-foreground">{s.usage} uses</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <p className="text-muted-foreground">{s.description}</p>
                <div className="text-xs">Owner {s.owner} · in {s.factories.join(", ")}</div>
                {s.listingId ? (
                  <form action={installSkill} className="flex gap-2">
                    <input type="hidden" name="listingId" value={s.listingId} />
                    <select name="factory" className="h-7 flex-1 rounded-md border bg-background px-2 text-xs">
                      {factories
                        .filter((f) => !s.factories.includes(f.id))
                        .map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.name}
                          </option>
                        ))}
                    </select>
                    <SubmitButton size="sm">Install</SubmitButton>
                  </form>
                ) : (
                  <form action={publishSkill}>
                    <input type="hidden" name="factory" value={s.factories[0]} />
                    <input type="hidden" name="name" value={s.name} />
                    <SubmitButton size="sm" variant="outline">Publish to catalog</SubmitButton>
                  </form>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
        <Section title="Listings">
          <ul className="text-sm text-muted-foreground">
            {skills.listings.map((l) => (
              <li key={l.id}>
                {l.name} v{l.version} from {l.sourceFactory}: {l.installs.length} install{l.installs.length === 1 ? "" : "s"}
              </li>
            ))}
          </ul>
        </Section>
      </Page>
    </>
  );
}
