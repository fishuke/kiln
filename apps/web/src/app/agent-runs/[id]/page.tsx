import Link from "next/link";
import { notFound } from "next/navigation";
import { runAction, steerRun } from "@/app/actions";
import { AutoRefresh } from "@/components/kiln/auto-refresh";
import { SubmitButton } from "@/components/kiln/submit-button";
import { Page, PageHeader, Pre, Section } from "@/components/kiln/ui";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { api, safe } from "@/lib/kiln";
import { timeAgo, usd } from "@/lib/format";

const TONE: Record<string, string> = { message: "", tool_call: "text-sky-700 dark:text-sky-300", tool_result: "text-muted-foreground", steer: "text-violet-700", guard: "text-amber-700", error: "text-red-700", pushed: "text-emerald-700" };

export default async function AgentRun({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [run, events] = await Promise.all([safe(() => api.run(id), null), safe(() => api.runEvents(id), [])]);
  if (!run) notFound();
  return (
    <>
      <PageHeader
        crumbs={[{ label: "Runs", href: "/runs" }, ...(run.workItemId ? [{ label: run.workItemId, href: `/runs/${run.workItemId}` }] : []), { label: `${run.agent} run` }]}
        actions={
          <form action={runAction} className="flex gap-2">
            <input type="hidden" name="runId" value={run.id} />
            {run.live && (
              <>
                <SubmitButton name="action" value="pause" variant="outline" size="sm">Pause</SubmitButton>
                <SubmitButton name="action" value="cancel" variant="ghost" size="sm">Cancel</SubmitButton>
              </>
            )}
            {!run.live && <SubmitButton name="action" value="replay" variant="outline" size="sm">Replay</SubmitButton>}
          </form>
        }
      />
      <AutoRefresh enabled={run.live} ms={1500} />
      <Page>
        <div className="mb-6 grid gap-3 sm:grid-cols-4">
          {[
            ["Status", <Badge key="s" variant={run.status === "succeeded" ? "secondary" : run.status === "running" ? "default" : "destructive"}>{run.status}</Badge>],
            ["Harness", `${run.harness}${run.model ? ` · ${run.model}` : ""}`],
            ["Cost", usd(run.costUsd)],
            ["Started", timeAgo(run.startedAt)],
          ].map(([k, v]) => (
            <Card size="sm" key={String(k)}>
              <CardContent>
                <div className="text-xs text-muted-foreground">{k}</div>
                <div className="mt-1 text-sm font-medium">{v}</div>
              </CardContent>
            </Card>
          ))}
        </div>
        {run.live && (
          <form action={steerRun} className="mb-6 flex gap-2">
            <input type="hidden" name="runId" value={run.id} />
            <input name="text" placeholder="Steer the running agent, e.g. 'use the existing Button component'" className="h-9 flex-1 rounded-md border bg-background px-3 text-sm" />
            <SubmitButton>Steer</SubmitButton>
          </form>
        )}
        <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
          <Section title="Events" description={`${events.length} events · trace ${run.traceId.slice(0, 12)}`}>
            <ol className="space-y-1.5 font-mono text-xs">
              {events.map((e) => (
                <li key={e.id} className={`flex gap-3 ${TONE[e.type] ?? ""}`}>
                  <span className="w-8 shrink-0 text-right text-muted-foreground">{e.seq}</span>
                  <span className="w-20 shrink-0">{e.type}</span>
                  <span className="whitespace-pre-wrap break-all">{e.text}</span>
                </li>
              ))}
            </ol>
          </Section>
          <aside className="space-y-4 text-sm">
            <Card size="sm">
              <CardContent className="space-y-1">
                <div className="font-medium">Start state</div>
                <div className="text-xs text-muted-foreground">Definition {run.definitionSha.slice(0, 12)}</div>
                {run.startState.repos.map((r) => (
                  <div key={r.name} className="text-xs">
                    {r.url} @ {r.sha.slice(0, 10)} {r.branch && `(${r.branch})`}
                  </div>
                ))}
                {run.replayOf && (
                  <div className="text-xs">
                    Replay of <Link className="underline" href={`/agent-runs/${run.replayOf}`}>{run.replayOf}</Link>
                  </div>
                )}
              </CardContent>
            </Card>
            {run.scores.length > 0 && (
              <Card size="sm">
                <CardContent>
                  <div className="font-medium">Scores</div>
                  {run.scores.map((s) => (
                    <div key={s.id} className="text-xs">
                      {s.scorer}: <span className={s.passed ? "text-emerald-700" : "text-red-700"}>{s.label}</span> ({s.score})
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
            {run.result && (
              <Card size="sm">
                <CardContent>
                  <div className="mb-1 font-medium">Result</div>
                  <Pre className="p-2">{JSON.stringify(run.result, null, 2)}</Pre>
                </CardContent>
              </Card>
            )}
          </aside>
        </div>
        <Section title="Prompt">
          <Pre>{run.startState.prompt}</Pre>
        </Section>
        <Section title="Instructions">
          <Pre>{run.startState.instructions}</Pre>
        </Section>
      </Page>
    </>
  );
}
