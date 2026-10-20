import Link from "next/link";
import { ExternalLink, PlayCircle } from "lucide-react";
import { decideGate, sendTask } from "@/app/actions";
import { AutoRefresh } from "@/components/kiln/auto-refresh";
import { SubmitButton } from "@/components/kiln/submit-button";
import { ApiDown, Page, PageHeader, Section } from "@/components/kiln/ui";
import { Card, CardContent } from "@/components/ui/card";
import { api, safe } from "@/lib/kiln";
import { timeAgo } from "@/lib/format";

const COLUMNS = [
  { title: "Ideas", states: ["received", "triaging"] },
  { title: "Spec review", states: ["planning", "awaiting_spec"] },
  { title: "Building", states: ["building", "reviewing"] },
  { title: "Preview", states: ["awaiting_preview"] },
  { title: "Ready to merge", states: ["handed_off"] },
  { title: "Done", states: ["complete"] },
];

export default async function PoWorkspace({ searchParams }: { searchParams: Promise<{ tab?: string; factory?: string }> }) {
  const sp = await searchParams;
  const tab = sp.tab ?? "board";
  const [items, factories, inbox] = await Promise.all([safe(() => api.workItems({ factory: sp.factory }), null), safe(() => api.factories(), []), safe(() => api.inbox({ all: true }), [])]);
  if (!items) return <ApiDown />;
  const specs = inbox.filter((g) => g.kind === "spec");
  const previews = inbox.filter((g) => g.kind === "preview");
  const tabs = [
    ["board", "Idea board"],
    ["specs", `Spec review (${specs.length})`],
    ["previews", `Preview gallery (${previews.length})`],
  ];
  return (
    <>
      <PageHeader crumbs={[{ label: "PO workspace" }]} />
      <AutoRefresh ms={5000} />
      <Page>
        <div className="mb-6 flex gap-1 border-b">
          {tabs.map(([id, label]) => (
            <Link key={id} href={`/po?tab=${id}`} className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab === id ? "border-foreground font-medium" : "border-transparent text-muted-foreground"}`}>
              {label}
            </Link>
          ))}
        </div>

        {tab === "board" && (
          <>
            <Section title="New idea" description="Describe the outcome you want. The foreman asks questions when something is unclear, writes a spec for you to approve, and shows you a preview before anything is merged.">
              <form action={sendTask} className="grid gap-2 md:grid-cols-[1fr_200px_auto]">
                <textarea name="text" required rows={3} placeholder={"Saved carts\nShoppers can save a cart and come back to it.\n- A signed-in shopper can save the current cart"} className="rounded-md border bg-background p-2 text-sm" />
                <select name="factory" className="h-9 rounded-md border bg-background px-2 text-sm">
                  {factories.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
                <SubmitButton>Send to the factory</SubmitButton>
              </form>
            </Section>
            <div className="grid gap-3 overflow-x-auto md:grid-cols-3 xl:grid-cols-6">
              {COLUMNS.map((col) => {
                const cards = items.filter((w) => col.states.includes(w.state));
                return (
                  <div key={col.title} className="min-w-48 rounded-xl bg-muted/40 p-2">
                    <div className="mb-2 flex items-center justify-between px-1 text-xs font-medium text-muted-foreground">
                      {col.title}
                      <span>{cards.length}</span>
                    </div>
                    <div className="space-y-2">
                      {cards.map((w) => (
                        <Link key={w.id} href={`/runs/${w.id}`} className="block rounded-lg border bg-background p-2.5 text-sm shadow-xs hover:border-foreground/30">
                          <div className="line-clamp-2 font-medium">{w.title}</div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {w.factory} · {timeAgo(w.updatedAt)}
                          </div>
                          {w.spec && <div className="mt-1 text-xs text-muted-foreground">{w.spec.criteria.length} criteria</div>}
                        </Link>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {tab === "specs" && (
          <div className="space-y-4">
            {specs.length === 0 && <p className="text-sm text-muted-foreground">No specs are waiting for approval.</p>}
            {specs.map((g) => (
              <Card key={g.id}>
                <CardContent className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Link href={`/runs/${g.workItemId}`} className="font-medium hover:underline">
                      {g.workItem?.title ?? g.title}
                    </Link>
                    <span className="ml-auto text-xs text-muted-foreground">{g.factory} · {timeAgo(g.openedAt)}</span>
                  </div>
                  <ol className="space-y-1 text-sm">
                    {(g.workItem?.spec?.criteria ?? []).map((c) => (
                      <li key={c} className="rounded-md bg-muted/40 px-3 py-1.5">
                        {c}
                      </li>
                    ))}
                  </ol>
                  {g.workItem?.spec?.openQuestions.length ? <p className="text-sm text-amber-700">Open questions: {g.workItem.spec.openQuestions.join("; ")}</p> : null}
                  {g.evidence.map((e) => (
                    <a key={e.url} href={e.url} className="inline-flex items-center gap-1 text-xs underline" target="_blank" rel="noreferrer">
                      {e.label} <ExternalLink className="size-3" />
                    </a>
                  ))}
                  <form action={decideGate} className="flex gap-2">
                    <input type="hidden" name="gateId" value={g.id} />
                    <input type="hidden" name="back" value="/po?tab=specs" />
                    <input name="answer" placeholder="Changes you want (sent to the spec agent)" className="h-8 flex-1 rounded-md border bg-background px-2 text-sm" />
                    <SubmitButton name="decision" value="reject" variant="outline" size="sm">Request changes</SubmitButton>
                    <SubmitButton name="decision" value="approve" size="sm">Approve spec</SubmitButton>
                  </form>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {tab === "previews" && (
          <div className="grid gap-4 md:grid-cols-2">
            {previews.length === 0 && <p className="text-sm text-muted-foreground">No previews are waiting for acceptance.</p>}
            {previews.map((g) => {
              const videos = g.evidence.filter((e) => e.label !== "Preview");
              const url = g.workItem?.previewUrl;
              return (
                <Card key={g.id}>
                  <CardContent className="space-y-3">
                    <div className="flex aspect-video items-center justify-center rounded-lg bg-neutral-900 text-neutral-200">
                      <div className="text-center text-sm">
                        <PlayCircle className="mx-auto mb-2 size-10 opacity-80" />
                        {videos.length} video{videos.length === 1 ? "" : "s"} recorded
                      </div>
                    </div>
                    <Link href={`/runs/${g.workItemId}`} className="block font-medium hover:underline">
                      {g.workItem?.title}
                    </Link>
                    <div className="flex flex-wrap gap-2 text-xs">
                      {url && (
                        <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border px-2 py-1 hover:bg-muted">
                          Open preview <ExternalLink className="size-3" />
                        </a>
                      )}
                      {videos.map((v) => (
                        <a key={v.url} href={v.url} className="rounded-md border px-2 py-1 hover:bg-muted">
                          {v.label}
                        </a>
                      ))}
                    </div>
                    <form action={decideGate} className="flex gap-2">
                      <input type="hidden" name="gateId" value={g.id} />
                      <input type="hidden" name="back" value="/po?tab=previews" />
                      <input name="answer" placeholder="What should change?" className="h-8 flex-1 rounded-md border bg-background px-2 text-sm" />
                      <SubmitButton name="decision" value="reject" variant="outline" size="sm">Send back</SubmitButton>
                      <SubmitButton name="decision" value="approve" size="sm">Accept</SubmitButton>
                    </form>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </Page>
    </>
  );
}
