"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CheckCircle2, ChevronDown, CircleHelp, ExternalLink, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Markdown } from "@/components/kiln/markdown";
import { PageHeader } from "@/components/kiln/ui";
import { Button, buttonVariants } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Proposal } from "@kiln/sdk-ts";
import { pct, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import { decideProposal, runImprovementNow } from "../actions";

export type ImprovementSettings = { threshold: number; maxAgeDays: number; reviewers: string; enabledScorers: string[] };

function EmptyIllustration() {
  return (
    <svg viewBox="0 0 120 80" className="mb-4 h-20 w-32 text-muted-foreground/40" aria-hidden>
      {[
        [14, 50, 22],
        [48, 36, 36],
        [82, 18, 54],
      ].map(([x, y, h]) => (
        <path key={x} d={`M${x} ${y + 6} l11 -6 l11 6 v${h - 12} l-11 6 l-11 -6 z`} className="fill-current" />
      ))}
      <path d="M20 40 Q60 10 104 8" className="fill-none stroke-current" strokeWidth={2} strokeDasharray="4 4" />
      <path d="M98 4 l8 4 l-7 6" className="fill-none stroke-current" strokeWidth={2} />
    </svg>
  );
}

const STATE: Record<Proposal["state"], string> = {
  open: "border-violet-300 bg-violet-50 text-violet-700 dark:border-violet-800 dark:bg-violet-950/50 dark:text-violet-300",
  merged: "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-400",
  rejected: "border-border bg-muted text-muted-foreground",
};

function ProposalCard({ factory, p }: { factory: string; p: Proposal }) {
  const router = useRouter();
  const [open, setOpen] = useState(p.state === "open");
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  const decide = (d: "approve" | "reject") =>
    start(async () => {
      const r = await decideProposal(factory, p.id, d, reason);
      if (r.ok) toast.success(d === "approve" ? (p.needsTwoApprovals && (p.approvals?.length ?? 0) < 1 ? "Approval recorded; one more is needed" : "Approved: shipping as a 10% canary") : "Rejected; kept as a negative example");
      else toast.error(r.error);
      router.refresh();
    });
  const title = p.pr ? `Improve ${p.agent}: ${p.category}` : `${p.agent} · ${p.category}`;
  return (
    <article className="rounded-xl border">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-start gap-3 px-5 py-4 text-left">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{title}</span>
            <span className={cn("rounded-full border px-2 py-0.5 text-xs font-medium capitalize", STATE[p.state])}>{p.state}</span>
            {p.needsTwoApprovals && <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">needs 2 approvals ({p.approvals?.length ?? 0}/2)</span>}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {p.failures.length} failing run{p.failures.length === 1 ? "" : "s"} · replay pass rate {pct(p.passRateBefore)} → <span className="font-medium text-emerald-700 dark:text-emerald-400">{pct(p.passRateAfter)}</span> · {p.target === "app" ? "app code" : "factory definition"} · {timeAgo(p.createdAt)}
          </p>
        </div>
        {p.pr && (
          <a href={p.pr.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="inline-flex shrink-0 items-center gap-1 text-sm font-medium hover:underline">
            PR #{p.pr.number} <ExternalLink className="size-3.5" />
          </a>
        )}
        <ChevronDown className={cn("mt-1 size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="space-y-5 border-t px-5 py-4">
          <Markdown className="text-sm">{p.rationale}</Markdown>
          {p.droppedProtectedPaths.length > 0 && <p className="text-sm text-amber-700 dark:text-amber-400">Dropped changes to protected paths: {p.droppedProtectedPaths.join(", ")}</p>}
          <section>
            <h3 className="mb-2 text-sm font-semibold">Regressions addressed</h3>
            <ul className="divide-y rounded-lg border text-sm">
              {p.failures.map((f) => (
                <li key={f.scoreId} className="flex items-center justify-between gap-3 px-3 py-2">
                  <Link href={`/runs/${f.runId}`} className="font-mono text-xs hover:underline">
                    {f.runId}
                  </Link>
                  <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs text-red-700 dark:bg-red-950/50 dark:text-red-400">{f.label}</span>
                </li>
              ))}
            </ul>
          </section>
          {p.replay.length > 0 && (
            <section>
              <h3 className="mb-2 text-sm font-semibold">Replay</h3>
              <table className="w-full overflow-hidden rounded-lg border text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="px-3 py-2 font-normal">Run</th>
                    <th className="px-3 py-2 font-normal">Before</th>
                    <th className="px-3 py-2 font-normal">After</th>
                  </tr>
                </thead>
                <tbody>
                  {p.replay.map((r) => (
                    <tr key={r.runId} className="border-b last:border-0">
                      <td className="px-3 py-2">
                        <Link href={`/runs/${r.runId}`} className="font-mono text-xs hover:underline">
                          {r.runId}
                        </Link>
                      </td>
                      {[r.before, r.after].map((ok, i) => (
                        <td key={i} className="px-3 py-2">
                          <span className="inline-flex items-center gap-1">
                            {ok ? <CheckCircle2 className="size-4 text-emerald-600" /> : <XCircle className="size-4 text-red-600" />} {ok ? "Pass" : "Fail"}
                          </span>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
          {Object.keys(p.changes).length > 0 && (
            <section>
              <h3 className="mb-2 text-sm font-semibold">Changed files</h3>
              <ul className="flex flex-wrap gap-1.5">
                {Object.keys(p.changes).map((path) => (
                  <li key={path} className="rounded-md bg-muted px-2 py-0.5 font-mono text-xs">
                    {path}
                  </li>
                ))}
              </ul>
            </section>
          )}
          <details>
            <summary className="cursor-pointer text-sm text-muted-foreground">Full pull request description</summary>
            <Markdown className="mt-2 rounded-lg border p-3 text-sm">{p.body}</Markdown>
          </details>
          {p.state === "open" && (
            <div className="flex flex-wrap items-center gap-2 border-t pt-4">
              <Button disabled={pending} onClick={() => decide("approve")}>
                Approve as canary
              </Button>
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (kept as a negative example)" aria-label="Rejection reason" className="h-8 min-w-48 flex-1 rounded-lg border bg-background px-2.5 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50" />
              <Button variant="outline" disabled={pending} onClick={() => decide("reject")}>
                Reject
              </Button>
            </div>
          )}
        </div>
      )}
    </article>
  );
}

export function ImprovementView({ factory, factoryName, proposals, failures, settings }: { factory: string; factoryName: string; proposals: Proposal[]; failures: { agent: string; count: number; oldest: string }[]; settings: ImprovementSettings }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const runNow = () =>
    start(async () => {
      const r = await runImprovementNow(factory);
      if (!r.ok) toast.error(r.error);
      else toast.success(r.proposals ? `${r.proposals} improvement proposal${r.proposals === 1 ? "" : "s"} created` : "Self-improvement ran; no changes proposed");
      router.refresh();
    });
  return (
    <>
      <PageHeader
        crumbs={[{ label: factoryName, href: `/f/${factory}/dashboard` }, { label: "Self-improvement" }]}
        actions={
          <>
            <Button variant="outline" onClick={runNow} disabled={pending}>
              {pending ? "Running…" : "Run now"}
            </Button>
            <Link href={`/f/${factory}/settings#self-improvement`} className={buttonVariants()}>
              Configure
            </Link>
          </>
        }
      />
      <div className="mx-auto w-full max-w-5xl px-6 py-6">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Tooltip>
              <TooltipTrigger render={<button type="button" aria-label="About self-improvement" />}>
                <CircleHelp className="size-4" />
              </TooltipTrigger>
              <TooltipContent className="max-w-72">
                <b>Self-improvement</b>
                <br />
                Uses scorer failures to analyze agent behavior and propose changes for review.
              </TooltipContent>
            </Tooltip>
            Runs when an agent has {settings.threshold} unreviewed failures or its oldest is {settings.maxAgeDays} days old · reviewers: {settings.reviewers} · scorers: {settings.enabledScorers.length ? settings.enabledScorers.join(", ") : "none enabled"}
          </div>
          <Link href={`/runs?factory=${encodeURIComponent(factory)}&source=SELF_IMPROVEMENT&myRuns=false`} className="text-sm font-medium hover:underline">
            View all runs
          </Link>
        </div>

        {failures.length > 0 && (
          <section className="mb-8">
            <h2 className="mb-2 text-sm text-muted-foreground">Unreviewed failures</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {failures.map((f) => (
                <div key={f.agent} className="rounded-xl border p-4">
                  <div className="text-sm text-muted-foreground">{f.agent}</div>
                  <div className="mt-1 text-2xl font-semibold tabular-nums">
                    {f.count}
                    <span className="text-sm font-normal text-muted-foreground"> / {settings.threshold}</span>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-foreground" style={{ width: `${Math.min(100, (f.count / settings.threshold) * 100)}%` }} />
                  </div>
                  <div className="mt-2 text-xs text-muted-foreground">oldest {timeAgo(f.oldest)}</div>
                </div>
              ))}
            </div>
          </section>
        )}

        {proposals.length === 0 ? (
          <div className="flex flex-col items-center py-24 text-center">
            <EmptyIllustration />
            <p className="font-semibold text-muted-foreground">No self improvement PRs yet</p>
            <p className="mt-1 max-w-md text-sm text-muted-foreground">Proposed changes will appear here for your approval. Not every self-improvement run creates a PR — view all runs to see activity and outcomes.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {proposals.map((p) => (
              <ProposalCard key={p.id} factory={factory} p={p} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
