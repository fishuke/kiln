import { notFound } from "next/navigation";
import { canary, connectRepo, memory, syncFactory } from "@/app/actions";
import { SubmitButton } from "@/components/kiln/submit-button";
import { Page, PageHeader } from "@/components/kiln/ui";
import { Badge } from "@/components/ui/badge";
import { api, safe } from "@/lib/kiln";
import { timeAgo } from "@/lib/format";

function Block({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div>
        <div className="font-medium">{title}</div>
        {description && <div className="text-sm text-muted-foreground">{description}</div>}
      </div>
      {children}
    </div>
  );
}

export default async function Settings({ params }: { params: Promise<{ factory: string }> }) {
  const { factory } = await params;
  const [f, memories] = await Promise.all([safe(() => api.factory(factory), null), safe(() => api.memories(factory), [])]);
  if (!f) notFound();
  const d = f.definition;
  const repo = f.factory.definitionRepo;
  return (
    <>
      <PageHeader crumbs={[{ label: f.factory.name, href: `/f/${factory}` }, { label: "Settings" }]} />
      <Page narrow>
        <h2 className="mb-3 text-base">General info</h2>
        <div className="space-y-6 rounded-xl border bg-muted/30 p-6 text-sm">
          <Block title="Factory name" description={`Created ${timeAgo(f.factory.createdAt)}. Change it in factory.yaml.`}>
            <div className="rounded-md border bg-background px-3 py-2">{f.factory.name}</div>
          </Block>
          <Block title="Foreman name" description="The name you @-mention in Slack, Linear, Jira and GitHub.">
            <div className="rounded-md border bg-background px-3 py-2">@{f.factory.alias}</div>
          </Block>
          <Block title="Repos" description="The repos this factory works on.">
            <div className="flex flex-wrap gap-2">
              {(d.repositories as { owner: string; name: string; deferred?: boolean }[]).map((r) => (
                <Badge key={`${r.owner}/${r.name}`} variant="secondary">
                  {r.owner}/{r.name}
                  {r.deferred ? " (deferred)" : ""}
                </Badge>
              ))}
            </div>
          </Block>
          <Block title="Pull request author" description="Pull requests are authored by the factory's bot identity. No agent identity can approve or merge; a person merges.">
            <div className="text-muted-foreground">Agents push only kiln/* branches with short-lived scoped tokens.</div>
          </Block>
          <Block title="Agent defaults">
            <pre className="rounded-md border bg-background p-3 text-xs">{JSON.stringify(d.agentDefaults, null, 2)}</pre>
          </Block>
          <Block title="Self-improvement and budgets">
            <pre className="rounded-md border bg-background p-3 text-xs">{JSON.stringify({ selfImprovement: d.selfImprovement ?? "defaults", budgets: d.budgets ?? "none" }, null, 2)}</pre>
          </Block>
        </div>

        <h2 className="mt-10 mb-3 text-base">Factory repo</h2>
        <div className="space-y-4 rounded-xl border bg-muted/30 p-6 text-sm">
          {repo ? (
            <>
              <div>
                GitHub config repo <code>{repo.owner}/{repo.name}</code> on <code>{repo.ref}</code>
                {repo.dir ? ` (folder ${repo.dir})` : ""}. Merges apply automatically through the push webhook.
              </div>
              <form action={syncFactory}>
                <input type="hidden" name="factory" value={factory} />
                <SubmitButton size="sm" variant="outline">Sync now</SubmitButton>
              </form>
            </>
          ) : (
            <form action={connectRepo} className="space-y-2">
              <div className="text-muted-foreground">Managed by Kiln. Store it in a GitHub repo you own (factory.yaml at the root).</div>
              <div className="flex gap-2">
                <input name="repo" required placeholder="owner/factory-config" className="h-8 flex-1 rounded-md border bg-background px-2" />
                <input name="dir" placeholder="folder (optional)" className="h-8 w-40 rounded-md border bg-background px-2" />
                <SubmitButton size="sm">Connect</SubmitButton>
              </div>
            </form>
          )}
          {f.factory.canary && (
            <form action={canary} className="flex items-center gap-2">
              <input type="hidden" name="factory" value={factory} />
              <span className="flex-1">Canary {f.factory.canary.sha.slice(0, 10)} at {f.factory.canary.percent}%</span>
              <SubmitButton name="action" value="promote" size="sm">Promote</SubmitButton>
              <SubmitButton name="action" value="rollback" size="sm" variant="outline">Roll back</SubmitButton>
            </form>
          )}
        </div>

        <h2 className="mt-10 mb-3 text-base">Memories</h2>
        <div className="space-y-3 rounded-xl border bg-muted/30 p-6 text-sm">
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
                    <SubmitButton name="action" value="accept" size="xs">Accept</SubmitButton>
                    <SubmitButton name="action" value="reject" size="xs" variant="outline">Reject</SubmitButton>
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
            <input name="title" required placeholder="Teach a convention, e.g. Prices are integers in cents" className="h-8 w-full rounded-md border bg-background px-2" />
            <textarea name="body" required rows={2} placeholder="Why and how" className="w-full rounded-md border bg-background p-2" />
            <SubmitButton size="sm" variant="outline">Propose memory</SubmitButton>
          </form>
        </div>
      </Page>
    </>
  );
}
