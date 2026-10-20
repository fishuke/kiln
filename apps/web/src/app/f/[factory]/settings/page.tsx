import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { parse } from "yaml";
import { memory } from "@/app/actions";
import { SubmitButton } from "@/components/kiln/submit-button";
import { PageHeader } from "@/components/kiln/ui";
import { Badge } from "@/components/ui/badge";
import { listConnections } from "@/lib/api/factory-admin";
import { api, safe } from "@/lib/kiln";
import { loadAgentContext } from "../agents/[agent]/load";
import { SettingsView, type FactoryYaml } from "./settings-view";

export const metadata: Metadata = { title: "Settings" };

export default async function Settings({ params }: { params: Promise<{ factory: string }> }) {
  const { factory } = await params;
  const [ctx, memories, factories, connections, me] = await Promise.all([
    loadAgentContext(factory),
    safe(() => api.memories(factory), []),
    safe(() => api.factories(), []),
    listConnections(),
    safe(() => api.me() as Promise<{ subject: string }>, null),
  ]);
  if (!ctx) notFound();
  const { f } = ctx;
  let yaml: FactoryYaml = {};
  try {
    yaml = (parse(ctx.tree["factory.yaml"] ?? "") ?? {}) as FactoryYaml;
  } catch {
    yaml = f.definition as FactoryYaml;
  }
  if (!ctx.tree["factory.yaml"]) yaml = f.definition as FactoryYaml;

  return (
    <>
      <PageHeader crumbs={[{ label: f.factory.name, href: `/f/${factory}/dashboard` }, { label: "Settings" }]} />
      <SettingsView
        factory={factory}
        binding={{ name: f.factory.name, alias: f.factory.alias, createdAt: f.factory.createdAt, createdBy: (f.factory as { createdBy?: string }).createdBy ?? me?.subject, repo: f.factory.definitionRepo, canary: f.factory.canary, appliedSha: f.factory.appliedSha }}
        yaml={yaml}
        takenAliases={factories.filter((x) => x.id !== factory).map((x) => x.alias)}
        connections={connections}
        secrets={ctx.secrets}
        mcps={ctx.mcps}
        workers={ctx.workers}
        runners={ctx.runners}
        runnerFiles={ctx.runnerFiles}
        routers={ctx.routers}
        defaults={ctx.defaults}
        scorers={Object.entries(f.scorers).map(([slug, s]) => ({ slug, name: s.name ?? slug }))}
        readOnly={ctx.readOnly}
        memories={
      <section id="memories" className="scroll-mt-20">
        <h2 className="mb-3 text-lg font-medium text-muted-foreground">
          Memories
        </h2>
        <div className="space-y-3 rounded-xl border bg-muted/40 p-6 text-sm">
          <p className="text-muted-foreground">Conventions and decisions the factory has learned. Accepted memories are written to memories/ in the definition and given to agents when relevant.</p>
          <ul className="space-y-2">
            {memories.map((m) => (
              <li key={m.id} className="rounded-md border bg-background p-3">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{m.title}</span>
                  <Badge variant={m.status === "accepted" ? "secondary" : "outline"}>{m.status}</Badge>
                  <span className="ml-auto text-xs text-muted-foreground">by {m.author}</span>
                </div>
                <p className="mt-1 text-muted-foreground">{m.body}</p>
                {m.status === "proposed" && (
                  <form action={memory} className="mt-2 flex gap-2">
                    <input type="hidden" name="memoryId" value={m.id} />
                    <SubmitButton name="action" value="accept" size="xs">
                      Accept
                    </SubmitButton>
                    <SubmitButton name="action" value="reject" size="xs" variant="outline">
                      Reject
                    </SubmitButton>
                  </form>
                )}
              </li>
            ))}
            {Object.entries(f.memories).map(([slug, m]) => (
              <li key={slug} className="rounded-md border bg-background p-3">
                <span className="font-medium">{m.title}</span> <span className="text-xs text-muted-foreground">memories/{slug}.md</span>
                <p className="mt-1 text-muted-foreground">{m.body}</p>
              </li>
            ))}
          </ul>
          <form action={memory} className="space-y-2">
            <input type="hidden" name="factory" value={factory} />
            <input name="title" required placeholder="Teach a convention, e.g. Prices are integers in cents" className="h-9 w-full rounded-md border bg-background px-3" />
            <textarea name="body" required rows={2} placeholder="Why and how" className="w-full rounded-md border bg-background p-2" />
            <SubmitButton size="sm" variant="outline">
              Propose memory
            </SubmitButton>
          </form>
        </div>
      </section>
        }
      />
    </>
  );
}
