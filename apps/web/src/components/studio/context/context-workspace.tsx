"use client";

import { AppWindow, Check, ChevronsUpDown, Columns2, Eye, FileText, LoaderCircle, PanelLeft, PanelRight, ScrollText } from "lucide-react";
import { AnimatePresence, LayoutGroup, motion, MotionConfig } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Kbd } from "@/components/ui/kbd";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { StudioClient, StudioContextClient } from "@/lib/studio/client";
import type { DocBlock } from "@/lib/studio/context-doc";
import { canDecide, canEdit as mayEdit, catchUp, clampSplit, DEFAULT_SPLIT, fragmentsFrom, freshness, needsYou, questionsFrom, sinceLastVisit, VIEWER_NOTE } from "@/lib/studio/context-model";
import { altTypes } from "@/lib/studio/shortcuts";
import type { Member, Proposal } from "@/lib/studio/types";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { Composer } from "../composer";
import { PreviewPane } from "../preview-pane";
import { ShipControl } from "../ship";
import { AppSettingsLink, AppSwitcher } from "../top-bar";
import { useStudioApp } from "../use-studio";
import { focusNextQuestion } from "./blocks/question-block";
import { Brief } from "./brief";
import { DockStatus } from "./dock";
import { ContextDocument, type DocumentHandle } from "./document";
import { ROLE_LABEL } from "./fragment-meta";
import { FreshnessBar } from "./freshness";
import { ActivityPanel, ProposalsMenu } from "./panels";
import { memberColor, memberLine, PERMISSION_LABEL, Presence, type Present } from "./people";
import { useBrief, useContextPreview, useContextSnapshot } from "./use-context";

const EXAMPLES = ["A recipe box I can search by ingredient", "Daily habits I can tick off, with a streak for each", "A shared packing list for a weekend trip"];
const SPLIT_KEY = "kiln:studio:context-split";
type Full = "context" | "prototype" | undefined;

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Everyone who has the document open, from its awareness. */
function usePresent(ctx: StudioContextClient, appId: string, me: Member | undefined): Present[] {
  const [people, setPeople] = useState<Present[]>([]);
  useEffect(() => {
    const { awareness } = ctx.provider(appId);
    const read = () => {
      const seen = new Map<string, Present>();
      for (const s of awareness.getStates().values()) {
        const u = (s as { user?: Present }).user;
        if (u?.name && !seen.has(u.name)) seen.set(u.name, { name: u.name, color: u.color });
      }
      setPeople([...seen.values()]);
    };
    read();
    // The editor announces its user while it is being created, which is during a render: read after it.
    let stop = false;
    const later = () => queueMicrotask(() => !stop && read());
    awareness.on("change", later);
    return () => {
      stop = true;
      awareness.off("change", later);
    };
  }, [ctx, appId]);
  // The person themselves shows at once, before the editor has announced them.
  if (me && !people.some((p) => p.name === me.name)) return [{ name: me.name, color: memberColor(me.user) }, ...people];
  return people;
}

/** What the prototype pane says before the first build: what it is waiting for, never an empty pane. */
function Waiting({ building, busy, progress, openQuestions, hasContext, canEdit, onBuild }: { building: boolean; busy: boolean; progress?: string; openQuestions: number; hasContext: boolean; canEdit: boolean; onBuild(): void }) {
  const text = building
    ? "Building the first version"
    : busy
      ? "The agent is working on the Context. The first version follows"
      : openQuestions
      ? "Answer the questions and I'll build the first version"
      : hasContext
        ? "The Context is ready to build from"
        : "Your prototype appears here, built from the Context on the left";
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
      <div className="flex size-14 items-center justify-center rounded-2xl border bg-background shadow-xs">{building ? <LoaderCircle className="size-6 animate-spin text-violet-600 dark:text-violet-400" /> : <AppWindow className="size-6 text-muted-foreground" />}</div>
      <p className={cn("max-w-xs text-sm text-pretty", building ? "shimmer" : "text-muted-foreground")}>{text}</p>
      {building && progress && <p className="text-xs text-muted-foreground tabular-nums">{progress}</p>}
      {!busy && !openQuestions && hasContext && canEdit && (
        <Button size="sm" onClick={onBuild}>
          Build prototype
        </Button>
      )}
    </div>
  );
}

/**
 * The Context page (docs/specs/studio-context.md): the Context on the left, the prototype on the
 * right, no chat rail and no mode. The conversation happens in the document: the agent asks with
 * question blocks, answers become decisions, and the prototype follows the Context.
 */
export function ContextWorkspace({ client, context: ctx, appId }: { client: StudioClient; context: StudioContextClient; appId: string }) {
  const { detail, refresh } = useStudioApp(client, appId);
  const { snap, error } = useContextSnapshot(ctx, appId);
  const app = detail?.app;
  const me = snap?.me;
  const canEdit = me ? mayEdit(me.permission) : false;

  const [blocks, setBlocks] = useState<DocBlock[]>([]);
  const [ready, setReady] = useState(false);
  const [away, setAway] = useState(false);
  const [route, setRoute] = useState("/");
  const [pane, setPane] = useState<"context" | "prototype">("context");
  const [activityOpen, setActivityOpen] = useState(false);
  const [proposalsOpen, setProposalsOpen] = useState(false);
  const [briefOpen, setBriefOpen] = useState(false);
  const docRef = useRef<DocumentHandle>(null);

  // The document is ready once it has synced; a beat later, so a document a peer (or the fake's
  // seed) is about to fill doesn't flash the first-run state.
  useEffect(() => {
    setReady(false);
    let timer: ReturnType<typeof setTimeout> | undefined;
    void ctx.provider(appId).synced.then(() => (timer = setTimeout(() => setReady(true), 450)));
    return () => clearTimeout(timer);
  }, [ctx, appId, me?.user]);

  const changes = useMemo(() => snap?.changes ?? [], [snap]);
  const versions = useMemo(() => {
    const v: Record<string, number> = {};
    for (const c of changes) if (c.change !== "removed") v[c.fragmentId] = (v[c.fragmentId] ?? 0) + 1;
    return v;
  }, [changes]);
  const questions = useMemo(() => questionsFrom(appId, blocks), [appId, blocks]);
  const fragments = useMemo(() => fragmentsFrom(appId, blocks, versions), [appId, blocks, versions]);
  const openQuestions = questions.filter((q) => q.status === "open");
  const fresh = useMemo(() => (snap ? freshness(snap.state, changes) : ({ kind: "never" } as const)), [snap, changes]);
  const agent = snap?.agent ?? { state: "idle" as const, label: "" };
  const busy = agent.state !== "idle" && agent.state !== "waiting";
  const turn = snap?.turns.find((t) => t.id === agent.turnId);
  const proposals = useMemo(() => snap?.proposals ?? [], [snap]);
  const members = snap?.members;
  const nameOf = useCallback((user: string) => (user === "agent" ? "the agent" : (members?.find((m) => m.user === user)?.name ?? user)), [members]);
  const present = usePresent(ctx, appId, me);
  const firstRun = ready && fragments.length === 0 && questions.length === 0 && (snap?.turns.length ?? 0) === 0 && !busy;

  const { preview, error: previewError } = useContextPreview(ctx, appId, snap?.state.builtVersion);
  const routes = useMemo(() => [...new Set(["/", ...fragments.flatMap((f) => (f.previewReference ? [f.previewReference.route] : []))])], [fragments]);
  const brief = useBrief(ctx, appId, snap?.state.version, ready && fragments.length > 0);

  // Catch-up: decided once per person when they land, from how they were before this visit.
  const [landing, setLanding] = useState<{ user: string; member: Member; reason: "new" | "returning" | "current" }>();
  useEffect(() => {
    if (!me || !app || landing?.user === me.user) return;
    const c = catchUp({ member: me, createdBy: app.createdBy, now: new Date() });
    setLanding({ user: me.user, member: me, reason: c.reason });
    setBriefOpen(c.open);
    void ctx.markSeen(appId).catch(() => undefined);
  }, [ctx, appId, me, app, landing]);
  const since = useMemo(() => (landing ? sinceLastVisit(changes, landing.member) : []), [changes, landing]);
  const needs = useMemo(() => (me ? needsYou({ member: me, questions, proposals, fragments }) : { questions: [], proposals: [], reviews: [] }), [me, questions, proposals, fragments]);

  // --- the split -------------------------------------------------------------------------------

  const [split, setSplit] = useState(DEFAULT_SPLIT);
  const [full, setFull] = useState<Full>();
  const [dragging, setDragging] = useState(false);
  const panes = useRef<HTMLDivElement>(null);
  const splitKey = me ? `${SPLIT_KEY}:${me.user}` : undefined;
  useEffect(() => {
    if (!splitKey) return;
    try {
      const saved = localStorage.getItem(splitKey);
      setSplit(saved ? clampSplit(Number(saved)) : DEFAULT_SPLIT);
    } catch {
      /* storage blocked */
    }
  }, [splitKey]);
  const saveSplit = useCallback(
    (value: number) => {
      setSplit(value);
      try {
        if (splitKey) localStorage.setItem(splitKey, String(value));
      } catch {
        /* storage blocked */
      }
    },
    [splitKey],
  );
  const startDrag = (e: React.PointerEvent) => {
    const el = panes.current;
    if (!el) return;
    e.preventDefault();
    setDragging(true);
    let last = split;
    const move = (ev: PointerEvent) => {
      const r = el.getBoundingClientRect();
      last = clampSplit(((ev.clientX - r.left) / r.width) * 100);
      setSplit(last);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      setDragging(false);
      saveSplit(last);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
  };

  // Keyboard: ⌥1 gives the Context the full width, ⌥2 the prototype, ⌥A opens Activity.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.metaKey || e.ctrlKey || altTypes(e)) return;
      if (e.code === "Digit1") setFull((f) => (f === "context" ? undefined : "context"));
      else if (e.code === "Digit2") setFull((f) => (f === "prototype" ? undefined : "prototype"));
      else if (e.code === "KeyA") setActivityOpen((o) => !o);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // --- what a person does ----------------------------------------------------------------------

  const act = useCallback(async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      return true;
    } catch (err) {
      toast.error(message(err));
      return false;
    }
  }, []);
  const send = useCallback(
    (text: string) =>
      act(async () => {
        const r = await ctx.prompt(appId, text);
        if (r.steered) toast("Sent to the running turn");
      }),
    [act, ctx, appId],
  );
  const build = useCallback(() => void act(() => ctx.build(appId)), [act, ctx, appId]);
  const go = useCallback((fragmentId: string) => {
    setPane("context");
    setFull((f) => (f === "prototype" ? undefined : f));
    setBriefOpen(false);
    requestAnimationFrame(() => docRef.current?.scrollTo(fragmentId));
  }, []);
  const showInPrototype = useCallback((r: string) => {
    setRoute(r);
    setPane("prototype");
    setFull((f) => (f === "context" ? undefined : f));
  }, []);
  const decide = useCallback(
    (p: Proposal, decision: "accept" | "reject") =>
      void act(async () => {
        await ctx.decideProposal(appId, p.id, decision);
        toast.success(decision === "accept" ? "Accepted. It is in the Context" : "Rejected");
      }),
    [act, ctx, appId],
  );

  if (error && !snap)
    return (
      <div className="flex h-screen items-center justify-center p-8 text-center text-sm">
        <div>
          <div className="font-medium">This Context didn&apos;t load</div>
          <div className="mt-1 text-muted-foreground">{error}</div>
        </div>
      </div>
    );
  if (!snap || !me)
    return (
      <div className="flex h-screen flex-col gap-3 p-4">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="flex-1" />
      </div>
    );

  const identities = ctx.identities?.();
  const composer = (
    <motion.div layoutId="ctx-composer" transition={{ duration: 0.25, ease: "easeOut" }}>
      <Composer working={busy} onSubmit={send} autoFocus placeholder={canEdit ? "Ask, change or build…" : "Ask, or propose a change…"} />
    </motion.div>
  );

  const hero = firstRun ? (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-5 py-10">
      <div className="flex flex-col gap-1.5 text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-balance">What are we making?</h1>
        <p className="text-sm text-pretty text-muted-foreground">Say it in a sentence. The agent asks what it needs to know, writes the Context with you, and builds the prototype from it.</p>
      </div>
      {composer}
      <div className="flex flex-col gap-1.5">
        {EXAMPLES.map((ex) => (
          <button key={ex} type="button" onClick={() => void send(ex)} className="rounded-lg border bg-background px-3 py-2 text-left text-sm text-muted-foreground transition-[background-color,color,transform] duration-150 hover:bg-muted/60 hover:text-foreground active:translate-y-px">
            {ex}
          </button>
        ))}
      </div>
    </div>
  ) : undefined;

  const leftWidth = full === "context" ? 100 : split;
  return (
    <MotionConfig reducedMotion="user">
      <LayoutGroup>
        <div className="flex h-screen min-h-0 flex-col">
          <header className="flex h-12 shrink-0 items-center gap-1 border-b px-2">
            {app ? <AppSwitcher client={client} app={app} href={(id) => `/studio/${id}`} /> : <Skeleton className="h-6 w-32" />}
            <Tooltip>
              <TooltipTrigger render={<Button size="sm" variant={activityOpen ? "secondary" : "ghost"} aria-pressed={activityOpen} onClick={() => setActivityOpen((o) => !o)} className="gap-1.5" />}>
                <ScrollText />
                <span className="hidden sm:inline">Activity</span>
              </TooltipTrigger>
              <TooltipContent>
                Every turn and what the agent did <Kbd>⌥A</Kbd>
              </TooltipContent>
            </Tooltip>
            <div className="ml-auto flex items-center gap-1.5">
              <ToggleGroup
                value={[full ?? "both"]}
                onValueChange={(v: string[]) => v[0] && setFull(v[0] === "both" ? undefined : (v[0] as Full))}
                size="sm"
                spacing={0}
                variant="outline"
                className="hidden lg:flex"
                aria-label="Panes"
              >
                <Tooltip>
                  <TooltipTrigger render={<ToggleGroupItem value="context" aria-label="Context only" />}>
                    <PanelLeft />
                  </TooltipTrigger>
                  <TooltipContent>
                    Context only <Kbd>⌥1</Kbd>
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger render={<ToggleGroupItem value="both" aria-label="Context and prototype" />}>
                    <Columns2 />
                  </TooltipTrigger>
                  <TooltipContent>Side by side</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger render={<ToggleGroupItem value="prototype" aria-label="Prototype only" />}>
                    <PanelRight />
                  </TooltipTrigger>
                  <TooltipContent>
                    Prototype only <Kbd>⌥2</Kbd>
                  </TooltipContent>
                </Tooltip>
              </ToggleGroup>
              <Presence people={present} agent={agent} className="mx-1" />
              {identities && ctx.setIdentity ? (
                <DropdownMenu>
                  <Tooltip>
                    <TooltipTrigger render={<DropdownMenuTrigger render={<Button size="sm" variant="ghost" disabled={busy} className="gap-1 px-2 font-normal" />} />}>
                      {me.name} · {PERMISSION_LABEL[me.permission]}
                      <ChevronsUpDown className="size-3 opacity-50" />
                    </TooltipTrigger>
                    <TooltipContent>Try the page as someone else (the development fake)</TooltipContent>
                  </Tooltip>
                  <DropdownMenuContent align="end" className="w-60">
                    <DropdownMenuGroup>
                      <DropdownMenuLabel>View as</DropdownMenuLabel>
                      {identities.map((m) => (
                        <DropdownMenuItem key={m.user} onClick={() => ctx.setIdentity?.(m.user)} className="items-start gap-2.5">
                          <span className="flex flex-col">
                            <span className="font-medium">{m.name}</span>
                            <span className="text-xs text-muted-foreground">{memberLine(m, ROLE_LABEL[m.role])}</span>
                          </span>
                          {m.user === me.user && <Check className="ml-auto size-4" />}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                !canEdit && (
                  <Tooltip>
                    <TooltipTrigger render={<span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground" />}>Viewer</TooltipTrigger>
                    <TooltipContent>{VIEWER_NOTE}</TooltipContent>
                  </Tooltip>
                )
              )}
              <ProposalsMenu proposals={proposals} me={me} open={proposalsOpen} onOpenChange={setProposalsOpen} nameOf={nameOf} onDecide={decide} />
              {app?.status === "ready" && fresh.kind !== "never" && (
                <ShipControl
                  pullRequest={detail?.pullRequest}
                  onShip={async (state) => {
                    const pr = await client.ship(app.id, { state });
                    await refresh();
                    return pr;
                  }}
                />
              )}
              <AppSettingsLink appId={appId} />
            </div>
          </header>

          <div className="flex shrink-0 border-b p-1.5 lg:hidden" role="tablist" aria-label="Pane">
            {(["context", "prototype"] as const).map((p) => (
              <button key={p} type="button" role="tab" aria-selected={pane === p} onClick={() => setPane(p)} className={cn("flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md text-sm text-muted-foreground", pane === p && "bg-muted font-medium text-foreground")}>
                {p === "context" ? <FileText className="size-4" /> : <Eye className="size-4" />}
                {p === "context" ? "Context" : "Prototype"}
                {p === "context" && openQuestions.length > 0 && <span className="size-1.5 rounded-full bg-orange-500" />}
              </button>
            ))}
          </div>

          <div ref={panes} className="flex min-h-0 flex-1" style={{ "--ctx-split": `${leftWidth}%` } as React.CSSProperties}>
            <section
              aria-label="Context"
              className={cn(
                "relative min-h-0 w-full min-w-0 flex-col overflow-hidden lg:w-(--ctx-split) lg:shrink-0",
                !dragging && "motion-safe:lg:transition-[width] motion-safe:lg:duration-200 motion-safe:lg:ease-out",
                pane === "context" ? "flex" : "hidden",
                full === "prototype" ? "lg:hidden" : "lg:flex",
              )}
            >
              <ContextDocument
                key={`${appId}:${me.user}`}
                ctx={ctx}
                appId={appId}
                me={me}
                proposals={proposals}
                versions={versions}
                agent={agent}
                nameOf={nameOf}
                onBlocks={setBlocks}
                onAway={setAway}
                onShowInPrototype={showInPrototype}
                handle={docRef}
                empty={hero}
                header={
                  ready && fragments.length > 0 && snap.state.version > 0 && landing ? (
                    <Brief
                      brief={brief}
                      open={briefOpen}
                      onOpenChange={setBriefOpen}
                      reason={briefOpen ? landing.reason : "current"}
                      since={since}
                      needs={needs}
                      proposalsToDecide={proposals.filter((p) => canDecide(me, p))}
                      nameOf={nameOf}
                      onGo={go}
                      onProposals={() => setProposalsOpen(true)}
                    />
                  ) : undefined
                }
              />
              {!firstRun && (
                <div className="@container shrink-0 border-t bg-background/80 backdrop-blur-sm">
                  <div className="mx-auto flex w-full max-w-[816px] flex-col gap-2 pt-2 pr-3 pb-3 pl-10 @lg:pr-8 @lg:pl-16">
                    <DockStatus
                      agent={agent}
                      turn={turn}
                      openQuestions={openQuestions.length}
                      fresh={fresh}
                      canEdit={canEdit}
                      hasContext={fragments.some((f) => f.type !== "section")}
                      away={away}
                      onJump={() => docRef.current?.jumpToAgent()}
                      onStop={() => void act(() => ctx.stop(appId))}
                      onQuestions={() => {
                        setPane("context");
                        requestAnimationFrame(() => focusNextQuestion());
                      }}
                      onContinue={() => void act(() => ctx.continueQuestions(appId))}
                      onBuild={build}
                    />
                    {ready ? composer : <Skeleton className="h-24 rounded-xl" />}
                  </div>
                </div>
              )}
              <AnimatePresence>{activityOpen && <ActivityPanel key="activity" turns={snap.turns} nameOf={nameOf} onClose={() => setActivityOpen(false)} />}</AnimatePresence>
            </section>

            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize the panes"
              aria-valuenow={split}
              aria-valuemin={28}
              aria-valuemax={72}
              tabIndex={0}
              onPointerDown={startDrag}
              onDoubleClick={() => saveSplit(DEFAULT_SPLIT)}
              onKeyDown={(e) => {
                if (e.key === "ArrowLeft") saveSplit(clampSplit(split - 2));
                else if (e.key === "ArrowRight") saveSplit(clampSplit(split + 2));
                else if (e.key === "Home") saveSplit(clampSplit(0));
                else if (e.key === "End") saveSplit(clampSplit(100));
                else if (e.key === "Enter") saveSplit(DEFAULT_SPLIT);
                else return;
                e.preventDefault();
              }}
              className={cn("ctx-separator hidden lg:block", full && "lg:hidden", dragging && "ctx-separator-active")}
            />

            <section aria-label="Prototype" className={cn("min-h-0 min-w-0 flex-1", pane === "prototype" ? "block" : "hidden", full === "context" ? "lg:hidden" : "lg:block")}>
              <PreviewPane
                preview={preview}
                error={previewError}
                reload={0}
                routes={routes}
                view="preview"
                onViewChange={() => undefined}
                diffKey=""
                tabs={false}
                route={route}
                onRouteChange={setRoute}
                footer={<FreshnessBar fresh={fresh} building={agent.state === "building"} canEdit={canEdit} onUpdate={build} onGo={go} />}
              >
                {fresh.kind === "never" ? (
                  <Waiting
                    building={agent.state === "building"}
                    busy={busy}
                    progress={agent.total ? `${agent.done ?? 0} of ${agent.total} files` : undefined}
                    openQuestions={openQuestions.length}
                    hasContext={fragments.some((f) => f.type !== "section")}
                    canEdit={canEdit}
                    onBuild={build}
                  />
                ) : undefined}
              </PreviewPane>
            </section>
          </div>
          {dragging && <div className="fixed inset-0 z-50 cursor-col-resize" />}
        </div>
      </LayoutGroup>
    </MotionConfig>
  );
}
