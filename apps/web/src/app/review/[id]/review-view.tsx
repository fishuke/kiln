"use client";

import { Check, CircleAlert, GitPullRequest, MessagesSquare, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { submitReview } from "@/app/inbox/review-actions";
import { Markdown } from "@/components/kiln/markdown";
import { ReviewPanel } from "@/components/kiln/review-panel";
import { PageHeader } from "@/components/kiln/ui";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Trace, TraceDescription, TraceIcon, TraceLine, TraceTitle } from "@/components/ui/trace";
import { stateLabel, usd } from "@/lib/format";
import type { ProofMedia, ReviewModel } from "@/lib/review-model";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

const NOTES_SHOWN = 3;

export function ReviewView({ model, factory }: { model: ReviewModel; factory: { id: string; name: string } }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const reviewable = Boolean(model.pr) && !["complete", "cancelled"].includes(model.state);

  const send = (event: "APPROVE" | "REQUEST_CHANGES") => {
    if (event === "REQUEST_CHANGES" && !note.trim()) {
      toast.error("Say what to change in the note first");
      noteRef.current?.focus();
      return;
    }
    start(async () => {
      const r = await submitReview(model.id, { event, body: note.trim() || undefined });
      if (!r.ok) {
        toast.error("Could not send your review", { description: r.error });
        return;
      }
      toast.success(event === "APPROVE" ? "Approved" : "Sent back to the agents");
      router.refresh();
    });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        crumbs={[{ label: "Runs", href: "/runs" }, { label: factory.name, href: `/f/${factory.id}/dashboard` }, { label: "Review" }]}
        actions={
          reviewable && (
            <div className="flex items-center gap-2">
              <Button variant="outline" size="lg" disabled={pending} onClick={() => send("REQUEST_CHANGES")}>
                Request changes
              </Button>
              <Button size="lg" disabled={pending} onClick={() => send("APPROVE")}>
                Approve
              </Button>
            </div>
          )
        }
      />
      <div className="mx-auto w-full max-w-6xl px-6 pt-8 pb-16">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Badge variant="secondary">{stateLabel(model.state)}</Badge>
          {model.pr && (
            <a href={model.pr.url} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
              <GitPullRequest className="size-4" />
              {model.pr.repo}#{model.pr.number}
            </a>
          )}
          {model.pr?.additions !== undefined && (
            <span className="font-mono text-xs">
              <span className="text-emerald-600 dark:text-emerald-400">+{model.pr.additions}</span> <span className="text-red-600 dark:text-red-400">−{model.pr.deletions ?? 0}</span>
              {model.pr.changedFiles !== undefined && <span className="text-muted-foreground"> · {model.pr.changedFiles} files</span>}
            </span>
          )}
        </div>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight text-balance">{model.title}</h1>

        <Tabs defaultValue="overview" className="mt-6 gap-6">
          <TabsList variant="line">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            {model.pr && <TabsTrigger value="changes">Changes</TabsTrigger>}
          </TabsList>

          <TabsContent value="overview">
            <div className="flex flex-col gap-10 lg:flex-row">
              <div className="flex min-w-0 flex-1 flex-col gap-9">
                {model.wrong && (
                  <Section title="What was wrong">
                    <Markdown className="text-[15px] leading-7">{model.wrong}</Markdown>
                  </Section>
                )}
                <ProofSection model={model} />
                {model.notes.length > 0 && <NotesSection notes={model.notes} />}
                {reviewable && (
                  <Section title="Note to the agents (optional)">
                    <Textarea ref={noteRef} value={note} onChange={(e) => setNote(e.target.value)} placeholder="With Request changes, this goes back to the agents" className="min-h-20" />
                  </Section>
                )}
              </div>

              <aside className="flex w-full shrink-0 flex-col gap-7 lg:w-72">
                <Rail title="Checks">
                  {model.checks.length === 0 && <p className="text-sm text-muted-foreground">No checks were recorded.</p>}
                  {model.checks.map((c, i) => (
                    <div key={i} className="flex items-start gap-2 text-sm">
                      {c.ok ? <Check className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" /> : <X className="mt-0.5 size-4 shrink-0 text-destructive" />}
                      <CheckText text={c.text} />
                    </div>
                  ))}
                </Rail>
                {model.limits && (
                  <div className="flex flex-col gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4">
                    <div className="flex items-center gap-2 text-sm font-medium text-amber-700 dark:text-amber-300">
                      <CircleAlert className="size-4" />
                      Limits of the proof
                    </div>
                    <p className="text-sm leading-6 break-words">{model.limits}</p>
                  </div>
                )}
                <Rail title="How the agents got here">
                  <Trace>
                    {model.steps.map((s) => (
                      <Link key={s.id} href={`/runs/${s.id}`}>
                        <TraceLine status={s.status === "running" ? "running" : s.status === "failed" ? "error" : undefined}>
                          <TraceIcon>{s.status === "failed" ? <X /> : <Check />}</TraceIcon>
                          <TraceTitle className="capitalize">{s.agent}</TraceTitle>
                          <TraceDescription>{s.status === "running" ? "running" : `${s.minutes} min`}</TraceDescription>
                        </TraceLine>
                      </Link>
                    ))}
                  </Trace>
                  <Link href={`/runs/${model.id}`} className={buttonVariants({ variant: "outline", size: "sm", className: "mt-1 w-fit" })}>
                    <MessagesSquare />
                    Open the agent chat
                  </Link>
                </Rail>
                <Rail title="Effort">
                  <p className="text-sm">
                    {model.minutes} min · {usd(model.costUsd)} · {model.steps.length} agent runs
                  </p>
                </Rail>
              </aside>
            </div>
          </TabsContent>

          {model.pr && (
            <TabsContent value="changes">
              <ReviewPanel taskId={model.id} onDone={() => router.refresh()} embedded />
            </TabsContent>
          )}
        </Tabs>
      </div>
    </div>
  );
}

function Section({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("flex flex-col gap-3", className)}>
      <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{title}</h2>
      {children}
    </section>
  );
}

function Rail({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{title}</h2>
      {children}
    </div>
  );
}

/** "name: detail" reads as a name with the detail under it; anything else stays one line. */
function CheckText({ text }: { text: string }) {
  const at = text.indexOf(": ");
  if (at < 0) return <span className="min-w-0 break-words">{text}</span>;
  return (
    <span className="flex min-w-0 flex-col">
      <span className="break-words">{text.slice(0, at)}</span>
      <span className="text-xs leading-5 break-words text-muted-foreground">{text.slice(at + 2)}</span>
    </span>
  );
}

function Shot({ media, label, tone, onOpen }: { media: ProofMedia; label?: string; tone?: "before" | "after"; onOpen: () => void }) {
  return (
    <figure className="flex min-w-0 flex-col gap-2">
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Enlarge ${label ?? media.name}`}
        className={cn("block cursor-zoom-in overflow-hidden rounded-xl border bg-white outline-none focus-visible:ring-2 focus-visible:ring-ring", tone === "before" && "border-red-500/40", tone === "after" && "border-emerald-500/40")}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- run artifacts are served by the files route, not optimised */}
        <img src={media.url} alt={label ? `${label}: ${media.name}` : media.name} className="aspect-[4/3] w-full object-cover object-top" />
      </button>
      <figcaption className="flex items-baseline gap-2 text-sm">
        {label && <span className={cn("font-medium", tone === "before" ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400")}>{label}</span>}
        <span className="truncate text-muted-foreground">{media.name}</span>
      </figcaption>
    </figure>
  );
}

function ProofSection({ model }: { model: ReviewModel }) {
  const { before, after, image, video, more } = model.proof;
  const [zoom, setZoom] = useState(false);
  const large = before && after ? [before, after] : image ? [image] : [];
  if (!before && !image && !video) {
    return (
      <Section title="Proof">
        <p className="text-sm text-muted-foreground">The agents attached no images or videos.</p>
      </Section>
    );
  }
  return (
    <Section title="Proof" className="gap-5">
      {before && after && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Shot media={before} label="Before" tone="before" onOpen={() => setZoom(true)} />
          <Shot media={after} label="After" tone="after" onOpen={() => setZoom(true)} />
        </div>
      )}
      {image && <Shot media={image} onOpen={() => setZoom(true)} />}
      <Dialog open={zoom} onOpenChange={setZoom}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-[min(1400px,95vw)]">
          <DialogHeader>
            <DialogTitle>{large.length === 2 ? "Before and after" : "Proof"}</DialogTitle>
            <DialogDescription>{large.map((m) => m.name).join(" · ")}</DialogDescription>
          </DialogHeader>
          <div className={cn("grid gap-4", large.length === 2 && "sm:grid-cols-2")}>
            {large.map((m, i) => (
              // eslint-disable-next-line @next/next/no-img-element -- run artifacts are served by the files route, not optimised
              <img key={m.url} src={m.url} alt={large.length === 2 ? `${i === 0 ? "Before" : "After"}: ${m.name}` : m.name} className={cn("w-full rounded-lg border bg-white", large.length === 2 && (i === 0 ? "border-red-500/40" : "border-emerald-500/40"))} />
            ))}
          </div>
        </DialogContent>
      </Dialog>
      {video && (
        <figure className="flex flex-col gap-2">
          <video src={video.url} controls preload="metadata" className="aspect-video w-full rounded-xl border bg-black" />
          <figcaption className="truncate text-sm text-muted-foreground">{video.name}</figcaption>
        </figure>
      )}
      {more.length > 0 && (
        <Collapsible>
          <CollapsibleTrigger render={<Button variant="outline" size="sm" className="w-fit" />}>Show {more.length} more</CollapsibleTrigger>
          <CollapsibleContent>
            <ul className="mt-3 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
              {more.map((m) => (
                <li key={m.url} className="truncate">
                  <a href={m.url} target="_blank" rel="noreferrer" className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
                    {m.name}
                  </a>
                </li>
              ))}
            </ul>
          </CollapsibleContent>
        </Collapsible>
      )}
    </Section>
  );
}

function NotesSection({ notes }: { notes: string[] }) {
  const first = notes.slice(0, NOTES_SHOWN);
  const rest = notes.slice(NOTES_SHOWN);
  const row = (n: string, i: number) => (
    <li key={i} className="px-4 py-3">
      <Markdown className="text-sm leading-6">{n}</Markdown>
    </li>
  );
  return (
    <Section title={`Review notes · ${notes.length}`}>
      <ul className="divide-y rounded-xl border bg-card">{first.map(row)}</ul>
      {rest.length > 0 && (
        <Collapsible>
          <CollapsibleTrigger render={<Button variant="outline" size="sm" className="w-fit" />}>Show {rest.length} more</CollapsibleTrigger>
          <CollapsibleContent>
            <ul className="mt-3 divide-y rounded-xl border bg-card">{rest.map(row)}</ul>
          </CollapsibleContent>
        </Collapsible>
      )}
    </Section>
  );
}
