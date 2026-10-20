"use client";

import Link from "next/link";
import { ChevronDown, ChevronLeft, ChevronRight, Copy, Download, FileText, Globe, Loader2, Play, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { GitHubIcon } from "@/components/kiln/brand-icons";
import { AgentIcon, Chip, SourceIcon, StatusSquare, agentLook } from "@/components/kiln/run-visuals";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { usd } from "@/lib/format";
import type { AgentNode, ArtifactView } from "@/lib/run-detail";
import { longDuration, shortDuration, sourceLabel } from "@/lib/run-tree";
import { cn } from "@/lib/utils";
import type { RunDetailModel } from "./model";

export type DetailTab = "timeline" | "agents" | "artifacts" | "metadata";

export function DetailsPanel({ model, tab, onTab, isChild }: { model: RunDetailModel; tab: DetailTab; onTab: (t: DetailTab) => void; isChild: boolean }) {
  const tabs: DetailTab[] = isChild ? ["agents", "artifacts", "metadata"] : ["timeline", "agents", "artifacts", "metadata"];
  return (
    <aside aria-label="Run details" className="flex w-[432px] shrink-0 flex-col border-l">
      <div role="tablist" className="mx-4 flex gap-1 border-b py-3">
        {tabs.map((t) => (
          <button key={t} role="tab" type="button" aria-selected={tab === t} onClick={() => onTab(t)} className={cn("h-9 rounded-lg px-4 text-sm font-medium text-muted-foreground hover:text-foreground", tab === t && "bg-muted text-foreground")}>
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {tab === "timeline" && <Timeline nodes={model.tree} currentId={model.id} />}
        {tab === "agents" && <AgentsTab nodes={model.tree} currentId={model.id} />}
        {tab === "artifacts" && <ArtifactsTab model={model} />}
        {tab === "metadata" && <MetadataTab model={model} />}
      </div>
    </aside>
  );
}

function flatten(nodes: AgentNode[]): AgentNode[] {
  return nodes.flatMap((n) => [n, ...flatten(n.children)]);
}

// ---- Timeline ----

function Timeline({ nodes, currentId }: { nodes: AgentNode[]; currentId: string }) {
  const all = flatten(nodes);
  // One column per agent; runs of the same agent share a column.
  const columns = [...new Set(all.map((n) => n.agent))];
  const start = Math.min(...all.map((n) => new Date(n.startedAt).getTime()));
  const end = Math.max(...all.map((n) => new Date(n.finishedAt ?? Date.now()).getTime()), start + 60_000);
  const span = end - start;
  const height = Math.max(420, Math.min(1400, all.length * 80));
  const ticks = useMemo(() => {
    const step = niceStep(span / 8);
    const out: number[] = [];
    for (let t = Math.ceil(start / step) * step; t <= end; t += step) out.push(t);
    return out;
  }, [start, end, span]);
  const tz = useMemo(() => {
    const off = -new Date().getTimezoneOffset() / 60;
    return `GMT${off >= 0 ? "+" : ""}${off}`;
  }, []);
  if (!all.length) return <p className="text-sm text-muted-foreground">No agent activity yet.</p>;
  const y = (t: number) => ((t - start) / span) * height;
  return (
    <div className="rounded-xl border">
      <div className="flex border-b">
        <div className="flex w-20 shrink-0 items-center justify-center py-2 text-xs font-medium text-muted-foreground" title="Timeline timezone">
          {tz}
        </div>
        {columns.map((a) => (
          <div key={a} className="flex flex-1 items-center justify-center border-l py-2" title={a}>
            <AgentIcon agent={a} size={20} />
          </div>
        ))}
      </div>
      <div className="relative flex" style={{ height: height + 40 }}>
        <div className="relative w-20 shrink-0">
          {ticks.map((t) => (
            <div key={t} className="absolute right-3 -translate-y-1/2 text-xs text-muted-foreground tabular-nums" style={{ top: y(t) + 20 }}>
              {new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
            </div>
          ))}
        </div>
        {columns.map((a) => (
          <div key={a} className="relative flex-1 border-l bg-muted/30">
            {all
              .filter((n) => n.agent === a)
              .map((n) => {
                const top = y(new Date(n.startedAt).getTime()) + 20;
                const h = Math.max(24, y(new Date(n.finishedAt ?? Date.now()).getTime()) - y(new Date(n.startedAt).getTime()));
                const dur = shortDuration(new Date(n.finishedAt ?? Date.now()).getTime() - new Date(n.startedAt).getTime());
                return (
                  <Link
                    key={n.id}
                    href={`/runs/${n.id}`}
                    aria-label={`${n.title} · ${n.status} · ${dur}`}
                    title={`${n.title} · ${dur}`}
                    className={cn("absolute left-1/2 w-9 -translate-x-1/2 rounded-sm border", agentLook(a).bar, n.id === currentId && "ring-2 ring-foreground/60 ring-offset-2 ring-offset-background")}
                    style={{ top, height: h }}
                  >
                    <span className="absolute -bottom-7 left-1/2 -translate-x-1/2">
                      <StatusSquare status={n.status} size={20} />
                    </span>
                  </Link>
                );
              })}
          </div>
        ))}
      </div>
    </div>
  );
}

function niceStep(ms: number): number {
  const steps = [60_000, 2 * 60_000, 5 * 60_000, 10 * 60_000, 15 * 60_000, 30 * 60_000, 3_600_000, 2 * 3_600_000, 6 * 3_600_000, 86_400_000];
  return steps.find((s) => s >= ms) ?? 86_400_000;
}

// ---- Agents ----

function AgentsTab({ nodes, currentId }: { nodes: AgentNode[]; currentId: string }) {
  if (!nodes.length) return <p className="text-sm text-muted-foreground">No agents ran yet.</p>;
  return (
    <ul className="flex flex-col gap-0.5">
      {nodes.map((n) => (
        <AgentRow key={n.id} node={n} depth={0} currentId={currentId} />
      ))}
    </ul>
  );
}

function AgentRow({ node, depth, currentId }: { node: AgentNode; depth: number; currentId: string }) {
  const dur = node.finishedAt ? shortDuration(new Date(node.finishedAt).getTime() - new Date(node.startedAt).getTime()) : "running";
  return (
    <li>
      <Link href={depth ? `${node.href}?tab=agents&from=parent` : node.href} className={cn("flex h-10 items-center gap-2 rounded-lg px-2 text-sm hover:bg-muted", node.id === currentId && "bg-muted")} style={{ paddingLeft: 8 + depth * 48 }}>
        <StatusSquare status={node.status} size={20} />
        <AgentIcon agent={node.agent} size={20} />
        <span className="min-w-0 flex-1 truncate">{node.title}</span>
        <span className="shrink-0 text-muted-foreground tabular-nums">
          {dur} • {usd(node.costUsd)}
        </span>
      </Link>
      {node.children.length > 0 && (
        <ul className="flex flex-col gap-0.5">
          {node.children.map((c) => (
            <AgentRow key={c.id} node={c} depth={depth + 1} currentId={currentId} />
          ))}
        </ul>
      )}
    </li>
  );
}

// ---- Artifacts ----

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <section className="mb-5">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="mb-2 flex w-full items-center gap-1.5 text-base font-medium">
        <ChevronDown className={cn("size-4 text-muted-foreground transition-transform", !open && "-rotate-90")} />
        {title}
        <span className="ml-auto text-sm font-normal text-muted-foreground">{count}</span>
      </button>
      {open && children}
    </section>
  );
}

const PR_TONE = { open: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400", merged: "bg-violet-500/10 text-violet-700 dark:text-violet-400", closed: "bg-red-500/10 text-red-700 dark:text-red-400" };

function ArtifactsTab({ model }: { model: RunDetailModel }) {
  const { prs, previews, media, files } = model.artifacts;
  const [lightbox, setLightbox] = useState<number | null>(null);
  const empty = !prs.length && !previews.length && !media.length && !files.length && !model.spec && !model.review;
  if (empty) return <p className="text-sm text-muted-foreground">This run has no artifacts yet. Pull requests, previews, screenshots, recordings and reports appear here.</p>;
  return (
    <div>
      {prs.length > 0 && (
        <Section title="PRs" count={prs.length}>
          <div className="flex flex-col gap-2">
            {prs.map((p) => (
              <a key={p.url} href={p.url} target="_blank" rel="noreferrer" className="block rounded-lg border p-3 hover:bg-muted/50">
                <span className={cn("inline-flex h-6 items-center gap-1 rounded-full px-2 text-xs font-medium", PR_TONE[p.state])}>
                  <GitHubIcon className="size-3.5" />
                  {p.state === "open" ? "Open PR" : p.state === "merged" ? "Merged PR" : "Closed PR"}
                </span>
                {p.branch && <div className="mt-2 truncate text-sm">{p.branch}</div>}
                <div className="mt-1 text-xs text-muted-foreground">
                  {p.repo}#{p.number}
                </div>
              </a>
            ))}
          </div>
        </Section>
      )}
      {previews.length > 0 && (
        <Section title="Previews" count={previews.length}>
          {previews.map((p) => (
            <a key={p.url} href={p.url} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-lg border p-3 text-sm hover:bg-muted/50">
              <Globe className="size-4 text-muted-foreground" />
              <span className="truncate">{p.url}</span>
            </a>
          ))}
        </Section>
      )}
      {model.spec && (
        <Section title="Spec" count={model.spec.criteria.length}>
          <ul className="flex flex-col gap-1.5 rounded-lg border p-3 text-sm">
            {model.spec.criteria.map((c) => (
              <li key={c.text} className="flex gap-2">
                <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", c.status === "passed" ? "bg-emerald-500" : c.status ? "bg-red-500" : "bg-muted-foreground/30")} title={c.status ?? "not verified yet"} />
                <span className="flex-1">{c.text}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}
      {media.length > 0 && (
        <Section title="Screencaptures" count={media.length}>
          <div className="grid grid-cols-2 gap-2">
            {media.map((m, i) => (
              <button key={m.url} type="button" aria-label={`Open ${m.kind === "video" ? "video" : "screencapture"} ${i + 1}`} onClick={() => setLightbox(i)} className="relative aspect-[19/11] overflow-hidden rounded-md border bg-muted">
                {m.kind === "image" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={m.url} alt={m.name} loading="lazy" className="size-full object-cover object-top" />
                ) : (
                  <>
                    <video src={m.url} preload="metadata" muted className="size-full object-cover" />
                    <span className="absolute inset-0 flex items-center justify-center">
                      <span className="flex size-8 items-center justify-center rounded-full bg-black/60 text-white">
                        <Play className="size-4 fill-current" />
                      </span>
                    </span>
                  </>
                )}
              </button>
            ))}
          </div>
        </Section>
      )}
      {files.length > 0 && (
        <Section title="Files" count={files.length}>
          <ul className="flex flex-col gap-1.5">
            {files.map((f) => (
              <li key={f.url}>
                <a href={f.url} download={f.name} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm hover:bg-muted/50">
                  <FileText className="size-4 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{f.name}</span>
                  <Download className="size-4 text-muted-foreground" />
                </a>
              </li>
            ))}
          </ul>
        </Section>
      )}
      {model.review && (
        <Section title="Review" count={model.review.findings.length}>
          <div className="rounded-lg border p-3 text-sm">
            <div className="font-medium capitalize">{model.review.verdict.replace(/_/g, " ")}</div>
            <ul className="mt-1 list-disc pl-4 text-muted-foreground">
              {model.review.findings.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </div>
        </Section>
      )}
      <Lightbox items={media} index={lightbox} onIndex={setLightbox} />
    </div>
  );
}

export function Lightbox({ items, index, onIndex }: { items: ArtifactView[]; index: number | null; onIndex: (i: number | null) => void }) {
  const [loading, setLoading] = useState(true);
  const item = index === null ? undefined : items[index];
  useEffect(() => setLoading(true), [index]);
  useEffect(() => {
    if (index === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") onIndex(Math.min(items.length - 1, index + 1));
      if (e.key === "ArrowLeft") onIndex(Math.max(0, index - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, items.length, onIndex]);
  return (
    <Dialog open={index !== null} onOpenChange={(o) => !o && onIndex(null)}>
      <DialogContent showCloseButton={false} className="flex h-[90vh] w-[92vw] max-w-[92vw] flex-col items-center justify-center gap-3 bg-transparent p-0 ring-0 sm:max-w-[92vw]">
        <DialogTitle className="sr-only">{item?.name ?? "Media"}</DialogTitle>
        <button type="button" aria-label="Close lightbox" onClick={() => onIndex(null)} className="fixed top-4 right-4 flex size-9 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70">
          <X className="size-5" />
        </button>
        {item && (
          <>
            <div className="relative flex min-h-0 w-full flex-1 items-center justify-center">
              {loading && <Loader2 className="absolute size-8 animate-spin text-violet-500" />}
              {item.kind === "image" ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={item.url} src={item.url} alt={item.name} onLoad={() => setLoading(false)} onError={() => setLoading(false)} className="max-h-full max-w-full rounded-lg object-contain" />
              ) : (
                <video key={item.url} src={item.url} controls autoPlay onLoadedData={() => setLoading(false)} onError={() => setLoading(false)} className="max-h-full max-w-full rounded-lg" />
              )}
            </div>
            <div className="flex items-center gap-4 text-sm text-white">
              <button type="button" aria-label="Previous media item" disabled={index === 0} onClick={() => onIndex(Math.max(0, index! - 1))} className="flex size-9 items-center justify-center rounded-full bg-black/50 hover:bg-black/70 disabled:opacity-30">
                <ChevronLeft className="size-5" />
              </button>
              <div className="max-w-[60vw] text-center">
                {item.caption && <div className="truncate">{item.caption}</div>}
                <div className="text-xs text-white/70">
                  {index! + 1} of {items.length}
                </div>
              </div>
              <button type="button" aria-label="Next media item" disabled={index === items.length - 1} onClick={() => onIndex(Math.min(items.length - 1, index! + 1))} className="flex size-9 items-center justify-center rounded-full bg-black/50 hover:bg-black/70 disabled:opacity-30">
                <ChevronRight className="size-5" />
              </button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---- Metadata ----

function copy(text: string) {
  void navigator.clipboard?.writeText(text).then(() => toast.success("Copied"));
}

function CopyValue({ value, label }: { value: string; label?: string }) {
  return (
    <span className="group/copy inline-flex max-w-full items-center gap-1.5">
      <span className="truncate">{label ?? value}</span>
      <button type="button" aria-label={`Copy ${label ?? value}`} onClick={() => copy(value)} className="shrink-0 text-muted-foreground hover:text-foreground">
        <Copy className="size-3.5" />
      </button>
    </span>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-4 py-2.5 text-sm">
      <div className="w-28 shrink-0 text-muted-foreground">{label}</div>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function MetadataTab({ model }: { model: RunDetailModel }) {
  const m = model.metadata;
  const [usageOpen, setUsageOpen] = useState(false);
  return (
    <div>
      <Row label="Env details">
        <div className="flex flex-col gap-1.5">
          {m.env.map((e, i) => (
            <CopyValue key={i} value={e.value} label={`${e.label}: ${e.value}`} />
          ))}
        </div>
      </Row>
      <Row label="ID">
        <CopyValue value={model.id} />
      </Row>
      <Row label="Run time">{longDuration(m.runTimeMs)}</Row>
      <Row label="Created">
        <span suppressHydrationWarning>
          {new Date(m.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).toLowerCase()} on {new Date(m.createdAt).toLocaleDateString("en-US")}
        </span>
      </Row>
      <Row label="Source">
        <Chip>
          <SourceIcon source={m.source} />
          {sourceLabel(m.source)}
        </Chip>
      </Row>
      <Row label="Usage">
        <button type="button" aria-expanded={usageOpen} onClick={() => setUsageOpen(!usageOpen)} className="flex w-full items-center justify-between">
          {usd(m.totalUsd)}
          <ChevronRight className={cn("size-4 text-muted-foreground transition-transform", usageOpen && "rotate-90")} />
        </button>
        {usageOpen && (
          <ul className="mt-2 flex flex-col gap-1.5">
            {m.usage.map((u, i) => (
              <li key={i} className="flex justify-between gap-3 text-muted-foreground">
                <span className="truncate">{u.label}</span>
                <span className="shrink-0 text-foreground tabular-nums">{usd(u.costUsd)}</span>
              </li>
            ))}
          </ul>
        )}
      </Row>
      {model.triage && (
        <Row label="Triage">
          {model.triage.kind} · size {model.triage.size} · {Math.round(model.triage.confidence * 100)}% confident
          {model.triage.summary && <div className="mt-1 text-muted-foreground">{model.triage.summary}</div>}
        </Row>
      )}
      {m.extra.map((e, i) => (
        <Row key={i} label={e.label}>
          {e.href ? (
            <a href={e.href} className="break-all text-violet-600 hover:underline dark:text-violet-400" target={e.href.startsWith("/") ? undefined : "_blank"} rel="noreferrer">
              {e.value}
            </a>
          ) : (
            <span className="break-words">{e.value}</span>
          )}
        </Row>
      ))}
    </div>
  );
}
