"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowUp,
  Award,
  ChevronsUpDown,
  EllipsisVertical,
  ExternalLink,
  FlaskConical,
  Laptop,
  Link2,
  List,
  PanelRight,
  Pause,
  Play,
  Plus,
  Repeat,
  Settings,
  Square,
  Undo2,
} from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { confirmLanded, handBack, pauseRun, replayRun, resumeRun, saveAsBenchmark, scoreThisRun, sendFollowup, stopRun, takeLocal } from "@/app/runs/actions";
import { AttachmentChips, useAttachments } from "@/components/kiln/attachments";
import { AgentIcon, StatusSquare } from "@/components/kiln/run-visuals";
import { PageHeader } from "@/components/kiln/ui";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { DetailsPanel, type DetailTab } from "./details-panel";
import type { RunDetailModel } from "./model";
import { Transcript } from "./transcript";

const PANEL_KEY = "kiln.run.details";
const PREFS_KEY = "kiln.run.prefs";

/** Follows the run's SSE stream and refreshes the server render as events arrive. */
function useLiveRun(runId: string | undefined, live: boolean) {
  const router = useRouter();
  useEffect(() => {
    if (!live) return;
    let pending: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      if (pending) return;
      pending = setTimeout(() => {
        pending = undefined;
        router.refresh();
      }, 800);
    };
    let es: EventSource | undefined;
    let poll: ReturnType<typeof setInterval> | undefined;
    if (runId && typeof EventSource !== "undefined") {
      es = new EventSource(`/api/runs/${runId}/stream`);
      es.onmessage = refresh;
      for (const t of ["message", "tool_call", "tool_result", "steer", "pushed", "error", "finished", "started", "reasoning", "thinking"])
        es.addEventListener(t, refresh);
      es.onerror = () => {
        es?.close();
        es = undefined;
        refresh();
        poll ??= setInterval(() => router.refresh(), 3000);
      };
    } else {
      poll = setInterval(() => router.refresh(), 3000);
    }
    return () => {
      es?.close();
      if (poll) clearInterval(poll);
      if (pending) clearTimeout(pending);
    };
  }, [runId, live, router]);
}

export function RunDetailView({ model }: { model: RunDetailModel }) {
  const router = useRouter();
  const sp = useSearchParams();
  const isChild = Boolean(model.root);
  const initialTab = (sp.get("tab") as DetailTab | null) ?? (isChild ? "agents" : "timeline");
  const [tab, setTab] = useState<DetailTab>(initialTab);
  const [panelOpen, setPanelOpen] = useState(Boolean(sp.get("tab")));
  const [showThinking, setShowThinking] = useState(true);
  const [showTools, setShowTools] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  useLiveRun(model.streamRunId, model.live);

  useEffect(() => {
    try {
      if (!sp.get("tab")) setPanelOpen(localStorage.getItem(PANEL_KEY) === "open");
      const prefs = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") as { thinking?: boolean; tools?: boolean };
      if (prefs.thinking === false) setShowThinking(false);
      if (prefs.tools === false) setShowTools(false);
    } catch {
      /* storage unavailable */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the newest messages in view.
  const count = model.transcript.length;
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [count]);

  const savePrefs = (thinking: boolean, tools: boolean) => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ thinking, tools }));
    } catch {
      /* storage unavailable */
    }
  };
  const togglePanel = () => {
    const next = !panelOpen;
    setPanelOpen(next);
    try {
      localStorage.setItem(PANEL_KEY, next ? "open" : "closed");
    } catch {
      /* storage unavailable */
    }
  };
  const selectTab = (t: DetailTab) => {
    setTab(t);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", t);
    window.history.replaceState(null, "", url);
  };

  // Runs › factory › this run, for child runs too (the agent switcher links back to the root).
  // Long titles are shortened here so the ancestor crumbs never collapse to "R…".
  const crumbs = [
    { label: "Runs", href: "/runs" },
    { label: model.factory.name, href: `/runs?all=1&factory=${model.factory.id}` },
    { label: shorten(model.title, 96) },
  ];

  return (
    <div className="flex h-screen flex-col">
      <PageHeader crumbs={crumbs} />
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-12 shrink-0 items-center justify-between gap-2 px-6">
            <AgentSwitcher model={model} />
            <div role="group" aria-label="Chat actions" className="flex items-center gap-1">
              <StopButton model={model} />
              <RunActionsMenu
                model={model}
                showThinking={showThinking}
                showTools={showTools}
                onThinking={(v) => (setShowThinking(v), savePrefs(v, showTools))}
                onTools={(v) => (setShowTools(v), savePrefs(showThinking, v))}
                onReplayed={(id) => router.push(`/runs/${id}`)}
              />
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      aria-label={panelOpen ? "Hide run details" : "Show run details"}
                      aria-pressed={panelOpen}
                      onClick={togglePanel}
                      className={cn(
                        "flex size-7 items-center justify-center rounded-md border text-muted-foreground hover:bg-muted hover:text-foreground",
                        panelOpen && "bg-muted text-foreground",
                      )}
                    />
                  }
                >
                  <PanelRight className="size-4" />
                </TooltipTrigger>
                <TooltipContent>{panelOpen ? "Hide run details" : "Show run details"}</TooltipContent>
              </Tooltip>
            </div>
          </div>
          <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-[976px] px-6 pt-2 pb-8">
              <Transcript
                items={model.transcript}
                showThinking={showThinking}
                showTools={showTools}
                prUrl={model.workItem?.prUrl}
                previewUrl={model.workItem?.previewUrl}
              />
              {model.live && (
                <div className="mt-5 flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="relative flex size-2">
                    <span className="absolute inline-flex size-full animate-ping rounded-full bg-violet-500 opacity-60" />
                    <span className="relative inline-flex size-2 rounded-full bg-violet-500" />
                  </span>
                  Working…
                </div>
              )}
            </div>
          </div>
          <div className="shrink-0 border-t px-6 pt-4 pb-4">
            <FollowupComposer model={model} />
          </div>
        </div>
        {panelOpen && <DetailsPanel model={model} tab={tab} onTab={selectTab} isChild={isChild} />}
      </div>
    </div>
  );
}

function AgentSwitcher({ model }: { model: RunDetailModel }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Switch agent; current agent: ${model.agentLabel}`}
        className="flex h-7 items-center gap-1.5 rounded-md px-1.5 text-sm font-semibold hover:bg-muted aria-expanded:bg-muted"
      >
        <AgentIcon agent={model.agent} />
        {model.agentLabel}
        <ChevronsUpDown className="size-4 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-100">
        {model.root && (
          <DropdownMenuItem className="h-10 gap-2 px-2" render={<Link href={`/runs/${model.root.id}`} />}>
            <StatusSquare status={model.root.status} size={20} />
            <AgentIcon agent="foreman" />
            <span className="truncate">{model.root.title}</span>
          </DropdownMenuItem>
        )}
        <DropdownMenuItem className="h-10 gap-2 bg-muted/60 px-2" render={<Link href={`/runs/${model.id}`} />}>
          <StatusSquare status={model.status} size={20} />
          <AgentIcon agent={model.agent} />
          <span className="truncate font-medium">{model.isWorkItem ? model.agentLabel : model.title}</span>
        </DropdownMenuItem>
        {model.subagents.length > 0 && (
          <DropdownMenuGroup>
            <DropdownMenuLabel className="px-2 pt-2 text-xs">Subagents</DropdownMenuLabel>
            {model.subagents.map((s) => (
              <DropdownMenuItem key={s.id} className="h-10 gap-2 px-2" render={<Link href={`/runs/${s.id}?tab=agents&from=parent`} />}>
                <StatusSquare status={s.status} size={20} />
                <AgentIcon agent={s.agent} />
                <span className="truncate">{s.title}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function StopButton({ model }: { model: RunDetailModel }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label="Stop run"
            disabled={!model.runActions.canStop || pending}
            onClick={() =>
              start(async () => {
                const r = await stopRun({ id: model.id, isWorkItem: model.isWorkItem });
                if (r.ok) toast.success("Run stopped");
                else toast.error("Could not stop the run", { description: r.error });
                router.refresh();
              })
            }
            className="flex size-7 items-center justify-center rounded-md bg-muted text-muted-foreground hover:text-foreground disabled:opacity-50"
          />
        }
      >
        <Square className="size-3 fill-current" />
      </TooltipTrigger>
      <TooltipContent>Stop run</TooltipContent>
    </Tooltip>
  );
}

function RunActionsMenu({
  model,
  showThinking,
  showTools,
  onThinking,
  onTools,
  onReplayed,
}: {
  model: RunDetailModel;
  showThinking: boolean;
  showTools: boolean;
  onThinking: (v: boolean) => void;
  onTools: (v: boolean) => void;
  onReplayed: (id: string) => void;
}) {
  const router = useRouter();
  const [, start] = useTransition();
  const [dialog, setDialog] = useState<null | "benchmark" | "local" | "handback">(null);
  const act = (fn: () => Promise<{ ok: boolean; error?: string }>, done: string) =>
    start(async () => {
      const r = await fn();
      if (r.ok) toast.success(done);
      else toast.error("That did not work", { description: "error" in r ? r.error : undefined });
      router.refresh();
    });
  const wi = model.workItem;
  const agentHref = `/f/${model.factory.id}/agents/${encodeURIComponent(model.agent)}`;
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="Run actions"
          className="flex size-7 items-center justify-center rounded-md border text-muted-foreground hover:bg-muted hover:text-foreground aria-expanded:bg-muted"
        >
          <EllipsisVertical className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuItem closeOnClick={false} className="h-9 justify-between px-2" onClick={() => onThinking(!showThinking)}>
            Show thinking
            <Switch checked={showThinking} tabIndex={-1} className="pointer-events-none" />
          </DropdownMenuItem>
          <DropdownMenuItem closeOnClick={false} className="h-9 justify-between px-2" onClick={() => onTools(!showTools)}>
            Show tool calls
            <Switch checked={showTools} tabIndex={-1} className="pointer-events-none" />
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="h-9 px-2" render={<Link href={agentHref} />}>
            <ExternalLink className="text-muted-foreground" />
            View agent
          </DropdownMenuItem>
          {!model.isWorkItem && (
            <DropdownMenuItem className="h-9 px-2" onClick={() => act(() => scoreThisRun(model.id), "Scoring started")}>
              <Award className="text-muted-foreground" />
              Score run
            </DropdownMenuItem>
          )}
          {model.runActions.canBenchmark && (
            <DropdownMenuItem className="h-9 px-2" onClick={() => setDialog("benchmark")}>
              <FlaskConical className="text-muted-foreground" />
              Add to benchmark
            </DropdownMenuItem>
          )}
          {model.runActions.canReplay && (
            <DropdownMenuItem
              className="h-9 px-2"
              onClick={() =>
                start(async () => {
                  const r = await replayRun(model.id);
                  if (r.ok) {
                    toast.success("Replay started");
                    onReplayed(r.id);
                  } else toast.error("Could not replay", { description: r.error });
                })
              }
            >
              <Repeat className="text-muted-foreground" />
              Replay run
            </DropdownMenuItem>
          )}
          {model.runActions.canPause && (
            <DropdownMenuItem className="h-9 px-2" onClick={() => act(() => pauseRun(model.id), "Run paused")}>
              <Pause className="text-muted-foreground" />
              Pause run
            </DropdownMenuItem>
          )}
          {model.runActions.canResume && (
            <DropdownMenuItem className="h-9 px-2" onClick={() => act(() => resumeRun(model.id), "Run resumed")}>
              <Play className="text-muted-foreground" />
              Resume run
            </DropdownMenuItem>
          )}
          {model.isWorkItem && wi && !["complete", "cancelled"].includes(wi.state) && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="h-9 px-2" onClick={() => setDialog("local")}>
                <Laptop className="text-muted-foreground" />
                Take local
              </DropdownMenuItem>
              <DropdownMenuItem className="h-9 px-2" onClick={() => setDialog("handback")}>
                <Undo2 className="text-muted-foreground" />
                Hand back to the factory
              </DropdownMenuItem>
              {wi.state === "handed_off" && (
                <DropdownMenuItem className="h-9 px-2" onClick={() => act(() => confirmLanded(wi.id), "Marked as landed")}>
                  <Award className="text-muted-foreground" />
                  Confirm it landed
                </DropdownMenuItem>
              )}
            </>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="h-9 px-2"
            onClick={() => void navigator.clipboard?.writeText(`${location.origin}/runs/${model.id}`).then(() => toast.success("Link copied"))}
          >
            <Link2 className="text-muted-foreground" />
            Copy link
          </DropdownMenuItem>
          <DropdownMenuItem className="h-9 px-2" render={<Link href={`/runs?mine=1&factory=${model.factory.id}`} />}>
            <List className="text-muted-foreground" />
            My runs from this factory
          </DropdownMenuItem>
          <DropdownMenuItem className="h-9 px-2" render={<Link href={`/f/${model.factory.id}/settings`} />}>
            <Settings className="text-muted-foreground" />
            Factory settings
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <BenchmarkDialog open={dialog === "benchmark"} onClose={() => setDialog(null)} runId={model.id} title={model.title} />
      {wi && <TakeLocalDialog open={dialog === "local"} onClose={() => setDialog(null)} workItemId={wi.id} />}
      {wi && <HandBackDialog open={dialog === "handback"} onClose={() => setDialog(null)} workItemId={wi.id} />}
    </>
  );
}

function shorten(s: string, max: number) {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > max ? `${one.slice(0, max - 1).trimEnd()}…` : one;
}

function slugify(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

function BenchmarkDialog({ open, onClose, runId, title }: { open: boolean; onClose: () => void; runId: string; title: string }) {
  const [suite, setSuite] = useState("default");
  const [slug, setSlug] = useState(slugify(title));
  const [criteria, setCriteria] = useState("");
  const [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add to benchmark</DialogTitle>
          <DialogDescription>
            Save this run&apos;s starting state and task as a benchmark task, so other models and settings can be compared on it.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="bm-suite">Suite</Label>
            <Input id="bm-suite" value={suite} onChange={(e) => setSuite(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="bm-slug">Task name</Label>
            <Input id="bm-slug" value={slug} onChange={(e) => setSlug(slugify(e.target.value))} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="bm-criteria">Success criteria (one per line)</Label>
            <Textarea id="bm-criteria" rows={3} value={criteria} onChange={(e) => setCriteria(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={pending || !suite || !slug}
            onClick={() =>
              start(async () => {
                const r = await saveAsBenchmark({ id: runId, suite, slug, title, criteria });
                if (!r.ok) {
                  toast.error("Could not save the benchmark task", { description: r.error });
                  return;
                }
                toast.success("Benchmark task saved", { description: r.files.join(", ") });
                onClose();
              })
            }
          >
            Save task
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TakeLocalDialog({ open, onClose, workItemId }: { open: boolean; onClose: () => void; workItemId: string }) {
  const [info, setInfo] = useState<{ branch: string; repo: string; cloneUrl: string } | null>(null);
  const [pending, start] = useTransition();
  useEffect(() => {
    if (!open || info) return;
    start(async () => {
      const r = await takeLocal(workItemId);
      if (r.ok) setInfo(r);
      else {
        toast.error("Could not take the task local", { description: r.error });
        onClose();
      }
    });
  }, [open, info, workItemId, onClose]);
  const cmd = `kiln pull ${workItemId}`;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Take this task local</DialogTitle>
          <DialogDescription>Continue in your own editor. The factory pauses this task until you hand it back.</DialogDescription>
        </DialogHeader>
        {pending || !info ? (
          <p className="text-sm text-muted-foreground">Preparing…</p>
        ) : (
          <div className="grid gap-2 text-sm">
            <div>Run this in a terminal:</div>
            <pre className="overflow-x-auto rounded-lg bg-muted p-3 font-mono text-xs">{cmd}</pre>
            <div className="text-muted-foreground">
              Repository {info.repo}, branch <code className="font-mono text-xs">{info.branch}</code>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => void navigator.clipboard?.writeText(cmd).then(() => toast.success("Command copied"))}>
            Copy command
          </Button>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function HandBackDialog({ open, onClose, workItemId }: { open: boolean; onClose: () => void; workItemId: string }) {
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Hand back to the factory</DialogTitle>
          <DialogDescription>Tell the foreman what you changed and what is left. It picks the task up from your branch.</DialogDescription>
        </DialogHeader>
        <Textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder="I fixed the layout; please add tests and finish the review." />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await handBack(workItemId, text);
                if (!r.ok) {
                  toast.error("Could not hand the task back", { description: r.error });
                  return;
                }
                toast.success("Handed back to the factory");
                onClose();
                router.refresh();
              })
            }
          >
            Hand back
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FollowupComposer({ model }: { model: RunDetailModel }) {
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  const files = useAttachments();
  const router = useRouter();
  const canSend = (text.trim().length > 0 || files.attachments.length > 0) && !files.uploading && !pending;
  const submit = () => {
    if (!canSend) return;
    start(async () => {
      const r = await sendFollowup({ id: model.id, isWorkItem: model.isWorkItem, text, attachments: files.attachments });
      if (!r.ok) {
        toast.error("Could not send your message", { description: r.error });
        return;
      }
      setText("");
      files.clear();
      router.refresh();
    });
  };
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        if (e.dataTransfer.files.length) void files.add(e.dataTransfer.files);
      }}
      className="mx-auto w-full max-w-[928px] rounded-xl border bg-background p-3 shadow-sm dark:bg-muted/20"
    >
      <AttachmentChips items={files.items} onRemove={files.remove} className="mb-2" />
      <textarea
        aria-label="Follow up"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          }
        }}
        rows={1}
        placeholder="Follow up"
        className="block max-h-48 min-h-8 w-full resize-none bg-transparent px-1 text-sm leading-6 outline-none placeholder:text-muted-foreground [field-sizing:content]"
      />
      <div className="mt-1 flex items-center">
        {files.input}
        <button
          type="button"
          aria-label="Add attachment"
          onClick={files.open}
          className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <Plus className="size-4" />
        </button>
        <button
          type="submit"
          aria-label="Send (Enter)"
          disabled={!canSend}
          className={cn(
            "ml-auto flex size-7 items-center justify-center rounded-md",
            canSend ? "bg-primary text-primary-foreground hover:bg-primary/85" : "bg-foreground/5 text-muted-foreground",
          )}
        >
          <ArrowUp className="size-4" />
        </button>
      </div>
    </form>
  );
}
