import Link from "next/link";
import { notFound } from "next/navigation";
import { Check, ExternalLink, GitPullRequest, Video } from "lucide-react";
import { cancelWorkItem, confirmComplete, decideGate, messageForeman } from "@/app/actions";
import { AutoRefresh } from "@/components/kiln/auto-refresh";
import { SubmitButton } from "@/components/kiln/submit-button";
import { Page, PageHeader, Section, StateBadge } from "@/components/kiln/ui";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api, safe } from "@/lib/kiln";
import { LIFECYCLE, stateLabel, timeAgo, usd } from "@/lib/format";
import { cn } from "@/lib/utils";

export default async function WorkItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const wi = await safe(() => api.workItem(id), null);
  if (!wi) notFound();
  const live = ["received", "triaging", "planning", "building", "reviewing"].includes(wi.state) || wi.runs.some((r) => r.status === "running");
  const openGates = wi.gates.filter((g) => g.state === "open");
  const reached = LIFECYCLE.indexOf(wi.state as (typeof LIFECYCLE)[number]);
  const skippedSpec = !wi.spec && reached > LIFECYCLE.indexOf("awaiting_spec");
  return (
    <>
      <PageHeader
        crumbs={[{ label: "Runs", href: "/runs" }, { label: wi.factory, href: `/f/${wi.factory}` }, { label: wi.title }]}
        actions={
          !["complete", "cancelled", "failed"].includes(wi.state) && (
            <form action={cancelWorkItem}>
              <input type="hidden" name="workItemId" value={wi.id} />
              <SubmitButton variant="ghost" size="sm">
                Cancel
              </SubmitButton>
            </form>
          )
        }
      />
      <AutoRefresh enabled={live} />
      <Page>
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{wi.title}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {wi.id} · from {wi.source.provider}
              {wi.source.url && (
                <>
                  {" "}
                  ·{" "}
                  <a href={wi.source.url} className="underline" target="_blank" rel="noreferrer">
                    source
                  </a>
                </>
              )}{" "}
              · requested by {wi.requester} · {timeAgo(wi.createdAt)} · {usd(wi.costUsd)} spent
              {wi.budgetUsd ? ` of ${usd(wi.budgetUsd)}` : ""}
            </p>
          </div>
          <StateBadge state={wi.state} />
        </div>

        <ol className="mb-8 flex flex-wrap gap-1.5">
          {LIFECYCLE.map((s, i) => {
            const skipped = (s === "planning" || s === "awaiting_spec") && skippedSpec;
            const done = reached >= i && !skipped;
            const current = wi.state === s;
            return (
              <li key={s} className={cn("flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs", current ? "border-foreground bg-foreground text-background" : done ? "bg-muted" : "text-muted-foreground", skipped && "line-through opacity-50")}>
                {done && !current && <Check className="size-3" />}
                {stateLabel(s)}
              </li>
            );
          })}
          {wi.state === "blocked" && <li className="rounded-full bg-red-100 px-2.5 py-1 text-xs text-red-900">Blocked: {wi.blockedReason}</li>}
        </ol>

        {openGates.map((g) => (
          <Card key={g.id} className="mb-6 ring-amber-300">
            <CardHeader>
              <CardTitle>{g.title}</CardTitle>
              <p className="text-sm text-muted-foreground">Waiting on {g.assignees.join(", ") || "anyone"} · opened {timeAgo(g.openedAt)}</p>
            </CardHeader>
            <CardContent className="space-y-3">
              {g.question && <pre className="rounded-lg bg-muted/50 p-3 font-sans text-sm whitespace-pre-wrap">{g.question}</pre>}
              <div className="flex flex-wrap gap-2">
                {g.evidence.map((e) => (
                  <a key={e.url} href={e.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-muted">
                    {e.label} <ExternalLink className="size-3" />
                  </a>
                ))}
              </div>
              <form action={decideGate} className="space-y-2">
                <input type="hidden" name="gateId" value={g.id} />
                <input type="hidden" name="back" value={`/runs/${wi.id}`} />
                <textarea name="answer" rows={2} placeholder={g.kind === "question" ? "Your answer" : "Optional note (sent to the agents if you request changes)"} className="w-full rounded-md border bg-background p-2 text-sm" />
                <div className="flex gap-2">
                  {g.kind === "question" ? (
                    <>
                      <SubmitButton name="decision" value="answer">Answer</SubmitButton>
                      <SubmitButton name="decision" value="reject" variant="outline">Stop</SubmitButton>
                    </>
                  ) : (
                    <>
                      <SubmitButton name="decision" value="approve">{g.kind === "merge" ? "Confirm it landed" : "Approve"}</SubmitButton>
                      {g.kind !== "merge" && <SubmitButton name="decision" value="reject" variant="outline">Request changes</SubmitButton>}
                    </>
                  )}
                </div>
              </form>
            </CardContent>
          </Card>
        ))}

        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <div>
            <Section title="Conversation" description="The foreman keeps one thread from intake to hand-off.">
              <ol className="space-y-3">
                {wi.conversation.map((c, i) => (
                  <li key={i} className={cn("rounded-xl border p-3 text-sm", c.role === "human" && "bg-sky-50 dark:bg-sky-950/30", c.role === "foreman" && "bg-muted/40")}>
                    <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">{c.from}</span>
                      <Badge variant="outline">{c.role}</Badge>
                      <span className="ml-auto">{timeAgo(c.at)}</span>
                    </div>
                    <div className="whitespace-pre-wrap">{c.text}</div>
                  </li>
                ))}
              </ol>
              {!["complete", "cancelled"].includes(wi.state) && (
                <form action={messageForeman} className="mt-3 flex gap-2">
                  <input type="hidden" name="workItemId" value={wi.id} />
                  <input name="text" placeholder="Message the foreman…" className="h-9 flex-1 rounded-md border bg-background px-3 text-sm" />
                  <SubmitButton>Send</SubmitButton>
                </form>
              )}
            </Section>

            <Section title="Agent runs">
              <ul className="divide-y rounded-xl border">
                {wi.runs.map((r) => (
                  <li key={r.id}>
                    <Link href={`/agent-runs/${r.id}`} className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-muted/50">
                      <span className="font-medium">{r.agent}</span>
                      <span className="text-muted-foreground">{r.stage}</span>
                      <span className="truncate text-muted-foreground">{r.summary}</span>
                      <span className="ml-auto shrink-0 tabular-nums text-muted-foreground">{usd(r.costUsd)}</span>
                      <Badge variant={r.status === "succeeded" ? "secondary" : r.status === "running" ? "default" : "destructive"}>{r.status}</Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            </Section>
          </div>

          <aside className="space-y-4">
            {wi.pr && (
              <Card size="sm">
                <CardContent className="space-y-2 text-sm">
                  <div className="flex items-center gap-2 font-medium">
                    <GitPullRequest className="size-4" /> Pull request
                  </div>
                  <a href={wi.pr.url} target="_blank" rel="noreferrer" className="block truncate underline">
                    {wi.pr.repo}#{wi.pr.number}
                  </a>
                  <div className="text-xs text-muted-foreground">Branch {wi.branch}</div>
                  {wi.state === "handed_off" && (
                    <form action={confirmComplete}>
                      <input type="hidden" name="workItemId" value={wi.id} />
                      <SubmitButton size="sm" variant="outline">Confirm it landed</SubmitButton>
                    </form>
                  )}
                </CardContent>
              </Card>
            )}
            {wi.previewUrl && (
              <Card size="sm">
                <CardContent className="text-sm">
                  <div className="font-medium">Preview</div>
                  <a href={wi.previewUrl} target="_blank" rel="noreferrer" className="block truncate underline">
                    {wi.previewUrl}
                  </a>
                </CardContent>
              </Card>
            )}
            {wi.triage && (
              <Card size="sm">
                <CardContent className="text-sm">
                  <div className="font-medium">Triage</div>
                  <div className="text-muted-foreground">
                    {wi.triage.kind} · size {wi.triage.size} · {Math.round(wi.triage.confidence * 100)}% confident
                  </div>
                  {wi.triage.summary && <p className="mt-1">{wi.triage.summary}</p>}
                </CardContent>
              </Card>
            )}
            {wi.spec && (
              <Card size="sm">
                <CardContent className="text-sm">
                  <div className="font-medium">Acceptance criteria</div>
                  <ul className="mt-1 space-y-1">
                    {wi.spec.criteria.map((c) => {
                      const id = /^(AC\d+)/.exec(c)?.[1] ?? c;
                      const ev = wi.evidence?.criteria[id];
                      return (
                        <li key={c} className="flex gap-2">
                          <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", ev?.status === "passed" ? "bg-emerald-500" : ev ? "bg-red-500" : "bg-neutral-300")} />
                          <span className="flex-1">{c}</span>
                          {ev?.videoUrl && (
                            <a href={ev.videoUrl} title="Video" className="text-muted-foreground hover:text-foreground">
                              <Video className="size-4" />
                            </a>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </CardContent>
              </Card>
            )}
            {wi.review && (
              <Card size="sm">
                <CardContent className="text-sm">
                  <div className="font-medium">Review: {wi.review.verdict.replace("_", " ")}</div>
                  <ul className="mt-1 list-disc pl-4 text-muted-foreground">
                    {wi.review.findings.map((f) => (
                      <li key={f}>{f}</li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}
            <Card size="sm">
              <CardContent className="text-sm">
                <div className="font-medium">Decisions</div>
                <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                  {wi.decisions.slice(-8).map((d, i) => (
                    <li key={i}>
                      {d.decision} → <span className="text-foreground">{d.action}</span> ({d.provider})
                    </li>
                  ))}
                </ul>
                <div className="mt-2 text-xs text-muted-foreground">Definition {wi.definitionSha.slice(0, 10)} · {wi.humanTouches} human touch{wi.humanTouches === 1 ? "" : "es"}</div>
              </CardContent>
            </Card>
          </aside>
        </div>
      </Page>
    </>
  );
}
