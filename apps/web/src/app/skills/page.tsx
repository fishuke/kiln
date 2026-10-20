import type { Metadata } from "next";
import { Puzzle } from "lucide-react";
import { EmptyIcon } from "@/components/kiln/settings-blocks";
import { ApiDown, PageHeader } from "@/components/kiln/ui";
import { Badge } from "@/components/ui/badge";
import { api, safe } from "@/lib/kiln";
import { InstallControl, PublishButton } from "./skill-actions";

export const metadata: Metadata = { title: "Skills" };

export default async function Skills() {
  const [skills, factories] = await Promise.all([safe(() => api.skills(), null), safe(() => api.factories(), [])]);
  if (!skills) return <ApiDown />;
  const name = (id: string) => factories.find((f) => f.id === id)?.name ?? id;
  return (
    <>
      <PageHeader crumbs={[{ label: "Skills" }]} />
      {skills.catalog.length === 0 ? (
        <EmptyIcon icon={<Puzzle className="size-4" />} title="No skills yet">
          Skills are SKILL.md folders in a factory definition. Add one under skills/ in a factory, then publish it here for other factories.
        </EmptyIcon>
      ) : (
        <div className="mx-auto w-full max-w-[820px] px-6 py-8">
          <p className="mb-6 text-sm text-muted-foreground">The catalog for this workspace. Publishing a skill lets other factories install it, which opens a pull request on their config repo or applies it to a Kiln-managed factory.</p>
          <h2 className="mb-3 text-lg font-medium text-foreground/70">Catalog</h2>
          <ul className="divide-y overflow-hidden rounded-xl border bg-muted/60 dark:bg-muted/30">
            {skills.catalog.map((s) => (
              <li key={`${s.name}-${s.listingId ?? s.factories[0]}`} className="flex items-start gap-4 px-5 py-4">
                <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg border bg-background text-muted-foreground">
                  <Puzzle className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold">{s.name}</span>
                    <Badge variant="outline">v{s.version}</Badge>
                    {s.listingId && <Badge variant="secondary">Published</Badge>}
                  </div>
                  <p className="mt-0.5 text-sm text-muted-foreground">{s.description}</p>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {s.owner} · in {s.factories.map(name).join(", ")} · {s.usage} use{s.usage === 1 ? "" : "s"}
                  </div>
                </div>
                <div className="shrink-0">
                  {s.listingId ? (
                    <InstallControl listingId={s.listingId} factories={factories.filter((f) => !s.factories.includes(f.id)).map((f) => ({ id: f.id, name: f.name }))} />
                  ) : (
                    s.factories[0] && <PublishButton factory={s.factories[0]} name={s.name} />
                  )}
                </div>
              </li>
            ))}
          </ul>
          {skills.listings.length > 0 && (
            <>
              <h2 className="mt-10 mb-3 text-lg font-medium text-foreground/70">Published listings</h2>
              <ul className="divide-y overflow-hidden rounded-xl border">
                {skills.listings.map((l) => (
                  <li key={l.id} className="flex items-center justify-between gap-4 px-5 py-3 text-sm">
                    <span>
                      <span className="font-medium">{l.name}</span> <span className="text-muted-foreground">v{l.version} from {name(l.sourceFactory)}</span>
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {l.installs.length} install{l.installs.length === 1 ? "" : "s"}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </>
  );
}
