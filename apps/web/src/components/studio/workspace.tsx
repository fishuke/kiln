"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Eye, GitMerge, History, ListTree, LoaderCircle, MessageSquare, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { StudioClient } from "@/lib/studio/client";
import {
  chatRunStatus,
  chatUsage,
  importSteps,
  nextMode,
  routesFrom,
  splitDiff,
  unappliedTurns,
  versionForTurn,
  versionNumber,
  reviewFor,
} from "@/lib/studio/model";
import type { Chat, ChatMode, MergeReview, Version } from "@/lib/studio/types";
import { cn } from "@/lib/utils";
import { Composer, MODE_ICON } from "./composer";
import { Confirm } from "./confirm";
import { HistoryPanel } from "./history-panel";
import { EmptyPreview, PreviewingBanner, PreviewPane, type PreviewView } from "./preview-pane";
import { FailedApp, FailedAppActions } from "./failed-app";
import { SetupPanel } from "./setup-panel";
import { AppSettingsLink, AppSwitcher, NeedsYouMenu } from "./top-bar";
import { TasksPanel } from "./child-chats";
import { ShipControl } from "./ship";
import { ConflictNote, TurnView, WaitingPrompt } from "./turn-view";
import { usePreview, useStudioApp, type PreviewTarget } from "./use-studio";
import { VersionCard } from "./version-card";

const STATUS_DOT: Record<Chat["status"], string> = {
  idle: "bg-muted-foreground/40",
  working: "bg-violet-500 animate-pulse",
  needs_you: "bg-amber-500",
  conflict: "bg-red-500",
  failed: "bg-red-500",
};

/** The chats switcher: one tab per chat (its status as a dot) and "+" for a new one. */
function ChatTabs({ chats, active, onPick, onNew }: { chats: Chat[]; active?: string; onPick: (id: string) => void; onNew: () => void }) {
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active, chats.length]);
  return (
    <div ref={list} role="tablist" aria-label="Chats" className="flex scroll-fade-x scrollbar-none items-center gap-1 overflow-x-auto px-3 py-2">
      {chats.map((c, i) => (
        <Tooltip key={c.id}>
          <TooltipTrigger
            render={
              <button
                type="button"
                role="tab"
                aria-selected={c.id === active}
                onClick={() => onPick(c.id)}
                className={cn(
                  "flex h-7 max-w-44 shrink-0 items-center gap-1.5 rounded-full border border-transparent px-2.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                  c.id === active && "border-border bg-background font-medium text-foreground shadow-xs",
                )}
              />
            }
          >
            <span className={cn("size-1.5 shrink-0 rounded-full", STATUS_DOT[c.status])} />
            <span className="truncate">{c.title}</span>
          </TooltipTrigger>
          <TooltipContent>
            {c.status === "needs_you" ? "Needs you" : c.status === "working" ? "Working" : c.status === "conflict" ? "Conflict" : c.title}
            {i < 9 && <Kbd>⌥{i + 1}</Kbd>}
          </TooltipContent>
        </Tooltip>
      ))}
      <Tooltip>
        <TooltipTrigger render={<Button size="icon-xs" variant="ghost" aria-label="New chat" onClick={onNew} className="shrink-0 rounded-full" />}>
          <Plus />
        </TooltipTrigger>
        <TooltipContent>
          New chat <Kbd>⌥N</Kbd>
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

/** A loading rail while the app loads: shimmering lines in the shape of a chat. */
function RailSkeleton() {
  return (
    <div className="flex flex-col gap-5 p-5">
      <Skeleton className="h-9 w-2/3 self-end rounded-xl" />
      <Skeleton className="h-4 w-1/3" />
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-20 w-full rounded-xl" />
    </div>
  );
}

/** The empty chat. */
function EmptyChat() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
      <div className="flex size-10 items-center justify-center rounded-xl border bg-background text-muted-foreground">
        <MessageSquare className="size-5" />
      </div>
      <div className="text-sm font-medium">No messages yet</div>
      <p className="text-sm text-muted-foreground">Describe what to build.</p>
    </div>
  );
}
/**
 * The Studio workspace for one app: the chat rail (app switcher, chats, conversation, composer) on
 * the left and the preview on the right; on narrow screens the two become tabs.
 */
export function Workspace({ client, appId }: { client: StudioClient; appId: string }) {
  const params = useSearchParams();
  const router = useRouter();
  const { detail, chats, status, error, finished, refresh, loadChat } = useStudioApp(client, appId);
  const [activeChat, setActiveChat] = useState<string | undefined>(params.get("chat") ?? undefined);
  const [panel, setPanel] = useState<"history" | "tasks">();
  const historyOpen = panel === "history";
  const setHistoryOpen = (f: boolean | ((o: boolean) => boolean)) =>
    setPanel((p) => ((typeof f === "function" ? f(p === "history") : f) ? "history" : undefined));
  const [previewVersion, setPreviewVersion] = useState<string>();
  const [view, setView] = useState<PreviewView>("preview");
  const [pane, setPane] = useState<"chat" | "preview">("chat");
  const [draftMode, setDraftMode] = useState<ChatMode>("build");
  const [draftModel, setDraftModel] = useState<string>();
  const [routes, setRoutes] = useState<string[]>(["/"]);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  const app = detail?.app;
  const versions = useMemo(() => detail?.versions ?? [], [detail]);
  const chatList = useMemo(() => detail?.chats ?? [], [detail]);
  const chatId = activeChat && chatList.some((c) => c.id === activeChat) ? activeChat : chatList.at(-1)?.id;
  const current = chatId ? chats[chatId] : undefined;
  const chat = current?.chat ?? chatList.find((c) => c.id === chatId);
  const turns = useMemo(() => current?.turns ?? [], [current]);
  const working = chat?.status === "working";
  const mode = draftMode;
  const latest = versions[0];
  const previewing = previewVersion ? versions.find((v) => v.id === previewVersion) : undefined;

  useEffect(() => {
    if (chatId) void loadChat(chatId);
  }, [chatId, loadChat]);
  // Live updates for the open chat over SSE; the App itself is polled slowly.
  useEffect(() => {
    if (!chatId || !client.watchChat) return;
    return client.watchChat(chatId, () => {
      void loadChat(chatId);
      void refresh();
    });
  }, [client, chatId, loadChat, refresh]);
  useEffect(() => {
    if (chat) setDraftMode(chat.mode);
    // A chat's mode is the composer's starting mode; switching chats resets it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat?.id]);

  const selectChat = useCallback(
    (id: string | undefined) => {
      setActiveChat(id);
      setPreviewVersion(undefined);
      const q = new URLSearchParams(params.toString());
      if (id) q.set("chat", id);
      else q.delete("chat");
      window.history.replaceState(null, "", `?${q.toString()}`);
    },
    [params],
  );

  const target: PreviewTarget | undefined = previewVersion
    ? { versionId: previewVersion }
    : chatId
      ? { chatId }
      : latest && app?.status === "ready"
        ? { versionId: latest.id }
        : undefined;
  const { preview, error: previewError, restart } = usePreview(client, target, finished);
  const restartPreview = useCallback(async () => {
    try {
      await restart();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }, [restart]);

  // The merge gate's record of the App's pull request: polled while the gate decides or a reviewer is on it.
  const pr = detail?.pullRequest;
  const [review, setReview] = useState<MergeReview>();
  useEffect(() => {
    if (!pr || pr.state === "uat" || pr.state === "cancelled") return setReview(undefined);
    let stop = false;
    const load = () =>
      client.mergeReviews().then(
        (rs) => !stop && setReview(reviewFor(rs, pr)),
        () => undefined,
      );
    void load();
    const t = pr.state === "merged" ? undefined : setInterval(load, 3000);
    return () => {
      stop = true;
      if (t) clearInterval(t);
    };
  }, [client, pr]);

  const loadDiff = useMemo(() => {
    if (previewVersion) return () => client.versionDiff(previewVersion);
    if (chatId) return () => client.chatDiff(chatId);
    return undefined;
  }, [client, chatId, previewVersion]);

  useEffect(() => {
    if (!loadDiff) return;
    loadDiff()
      .then((d) => setRoutes(routesFrom(splitDiff(d.diff).map((f) => f.path))))
      .catch(() => undefined);
  }, [loadDiff, finished]);

  const newChat = useCallback(
    async (prompt?: string, m: ChatMode = mode) => {
      try {
        const r = await client.newChat(appId, { prompt, mode: m, model: draftModel });
        selectChat(r.chat.id);
        await refresh();
        return true;
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err));
        return false;
      }
    },
    [client, appId, mode, draftModel, selectChat, refresh],
  );

  const send = useCallback(
    async (text: string, m: ChatMode = mode) => {
      if (!chatId || !turns.length) return newChat(text, m);
      try {
        const r = await client.send(chatId, { text, mode: m });
        if (r.steered) toast("Sent to the running turn");
        await loadChat(chatId);
        void refresh();
        return true;
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err));
        return false;
      }
    },
    [client, chatId, turns.length, mode, newChat, loadChat, refresh],
  );

  /** Allow or block the command a turn's run waits on; the person's own identity decides the gate. */
  const decideApproval = useCallback(
    async (gateId: string, decision: "approve" | "reject") => {
      try {
        await client.decideApproval(gateId, decision);
        if (chatId) await loadChat(chatId);
        void refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err));
      }
    },
    [client, chatId, loadChat, refresh],
  );

  // Keyboard: ⌥P mode, ⌥H history, ⌥K tasks, ⌥N new chat, ⌥1–9 chats, Esc leaves an old version.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && previewVersion) setPreviewVersion(undefined);
      if (!e.altKey || e.metaKey || e.ctrlKey) return;
      if (e.code === "KeyP") setDraftMode((m) => nextMode(m));
      else if (e.code === "KeyH") setPanel((p) => (p === "history" ? undefined : "history"));
      else if (e.code === "KeyK") setPanel((p) => (p === "tasks" ? undefined : "tasks"));
      else if (e.code === "KeyN") void newChat();
      else if (/^Digit[1-9]$/.test(e.code)) {
        const c = chatList[Number(e.code.slice(5)) - 1];
        if (c) selectChat(c.id);
      } else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [chatList, newChat, selectChat, previewVersion]);

  if (error && !detail)
    return (
      <div className="flex h-screen items-center justify-center p-8 text-center text-sm">
        <div>
          <div className="font-medium">This app didn&apos;t load</div>
          <div className="mt-1 text-muted-foreground">{error}</div>
        </div>
      </div>
    );

  const unapplied = chat && app && app.shipMode !== "cowboy" ? unappliedTurns(chat, turns) : [];
  const steps = app ? importSteps(app, preview) : [];
  const importing =
    app?.source.kind === "repo" &&
    !chatList.length &&
    (app.status !== "ready" || steps.some((s) => s.status !== "done"));

  const retryApp = async () => {
    await client.retryApp(appId);
    await refresh();
  };
  const deleteApp = async () => {
    await client.deleteApp(appId);
    toast.success("App deleted");
    router.push("/studio");
  };
  const bookmark = async (v: Version, on: boolean) => {
    await client.bookmark(v.id, on);
    await refresh();
  };
  const restore = async (v: Version) => {
    const r = await client.restore(v.id);
    setPreviewVersion(undefined);
    await refresh();
    toast.success(`Restored as v${versionNumber([...versions, r], r.id)}`);
  };
  const apply = async (id = chat?.id) => {
    if (!id) return;
    const r = await client.apply(id);
    if (r.ok) toast.success(`Applied as v${versionNumber([...versions, r.version], r.version.id)}: ${r.version.title}`);
    else if ("conflict" in r) toast.error(`Conflicts with main in ${r.conflict.join(", ")}`);
    else toast("Nothing new to apply");
    await refresh();
  };

  const rail = (
    <div className="flex h-full min-h-0 flex-col">
      {panel === "tasks" ? (
        <TasksPanel
          chats={chatList}
          statusOf={(c) => chatRunStatus(c, chats[c.id]?.turns.at(-1))}
          active={chatId}
          onOpen={(id) => {
            selectChat(id);
            setPanel(undefined);
          }}
          onStop={(c) => void client.interrupt(c.runId!).then(refresh, (e: unknown) => toast.error(e instanceof Error ? e.message : String(e)))}
          onDelete={(c) =>
            client.deleteChat(c.id).then(
              () => {
                toast.success(`Deleted ${c.title}`);
                return refresh();
              },
              (e: unknown) => toast.error(e instanceof Error ? e.message : String(e)),
            )
          }
          onClose={() => setPanel(undefined)}
        />
      ) : historyOpen ? (
        <HistoryPanel
          versions={versions}
          previewing={previewVersion}
          onPreview={(v) => {
            setPreviewVersion(v.id);
            setPane("preview");
          }}
          onBookmark={(v, on) => void bookmark(v, on)}
          onClose={() => setHistoryOpen(false)}
        />
      ) : (
        <>
          <ChatTabs chats={chatList} active={chatId} onPick={selectChat} onNew={() => void newChat()} />
          {!detail || (chatId && !current) ? (
            <RailSkeleton />
          ) : !turns.length && app?.firstPrompt && !chatList.length ? (
            <WaitingPrompt text={app.firstPrompt.text} />
          ) : !turns.length ? (
            <EmptyChat />
          ) : (
            <MessageScrollerProvider autoScroll defaultScrollPosition="end">
              <MessageScroller className="min-h-0 flex-1">
                <MessageScrollerViewport>
                  <MessageScrollerContent className="gap-8 px-4 pt-3 pb-6">
                    {turns.map((t) => {
                      const v = versionForTurn(t, turns, versions);
                      return (
                        <MessageScrollerItem key={t.id} messageId={t.id} scrollAnchor>
                          <TurnView
                            turn={t}
                            busy={working}
                            onDecideApproval={decideApproval}
                            onBuildPlan={(plan, inNew) => {
                              setDraftMode("build");
                              void (inNew ? newChat(plan, "build") : send(plan, "build"));
                            }}
                            versionCard={
                              <VersionCard
                                title={t.title ?? "Changes"}
                                version={v}
                                number={v ? versionNumber(versions, v.id) : undefined}
                                previewing={v ? previewVersion === v.id : false}
                                loadDiff={() => (v ? client.versionDiff(v.id) : client.chatDiff(t.chatId))}
                                onPreview={() => {
                                  setPreviewVersion(v && v.id !== latest?.id ? v.id : undefined);
                                  setView("preview");
                                  setPane("preview");
                                }}
                                onBookmark={v ? (on) => void bookmark(v, on) : undefined}
                              />
                            }
                          />
                        </MessageScrollerItem>
                      );
                    })}
                  </MessageScrollerContent>
                </MessageScrollerViewport>
                <MessageScrollerButton />
              </MessageScroller>
            </MessageScrollerProvider>
          )}
          <div className="flex shrink-0 flex-col gap-2 px-3 pt-1 pb-3">
            {chat?.status === "conflict" && chat.question && <ConflictNote files={chat.question} />}
            {unapplied.length > 0 && !working && (
              <div className="flex items-center gap-2 rounded-xl border bg-card px-3 py-2 text-sm shadow-xs">
                <GitMerge className="size-4 shrink-0 text-violet-600 dark:text-violet-400" />
                <span className="min-w-0 flex-1 truncate">
                  {unapplied.length} {unapplied.length === 1 ? "change" : "changes"} not applied
                </span>
                <Confirm
                  trigger={<Button size="sm">Apply</Button>}
                  icon={<GitMerge />}
                  title="Apply to main?"
                  description={`Merges ${unapplied.map((t) => t.title).join("; ")} into the app's main line as a new version.`}
                  action="Apply"
                  onConfirm={() => apply()}
                />
              </div>
            )}
            <Composer
              mode={mode}
              onModeChange={setDraftMode}
              model={chat?.model ?? draftModel ?? app?.model}
              harness={chat?.harness ?? app?.harness}
              onModelChange={setDraftModel}
              modelLocked={turns.length > 0}
              working={working}
              usage={turns.length ? chatUsage(turns) : undefined}
              onSubmit={(text) => send(text)}
              textareaRef={composerRef}
              autoFocus
            />
          </div>
        </>
      )}
    </div>
  );

  const ModeIcon = MODE_ICON[mode];
  return (
    <div className="flex h-screen min-h-0 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-1 border-b px-2">
        {app ? <AppSwitcher client={client} app={app} href={(id) => `/studio/${id}`} /> : <Skeleton className="h-6 w-32" />}
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="sm"
                variant={historyOpen ? "secondary" : "ghost"}
                aria-pressed={historyOpen}
                onClick={() => setHistoryOpen((o) => !o)}
                className="gap-1.5"
              />
            }
          >
            <History />
            <span className="hidden sm:inline">History</span>
          </TooltipTrigger>
          <TooltipContent>
            Versions and bookmarks <Kbd>⌥H</Kbd>
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="sm"
                variant={panel === "tasks" ? "secondary" : "ghost"}
                aria-pressed={panel === "tasks"}
                onClick={() => setPanel((p) => (p === "tasks" ? undefined : "tasks"))}
                className="gap-1.5"
              />
            }
          >
            <ListTree />
            <span className="hidden sm:inline">Tasks</span>
          </TooltipTrigger>
          <TooltipContent>
            Every chat and subagent <Kbd>⌥K</Kbd>
          </TooltipContent>
        </Tooltip>
        {working && (
          <span className="ml-1 hidden items-center gap-1.5 text-xs text-muted-foreground sm:flex">
            <LoaderCircle className="size-3.5 animate-spin" />
            <ModeIcon className="size-3.5" />
            Working
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          {app?.status === "ready" && (
            <ShipControl
              pullRequest={detail?.pullRequest}
              review={review}
              onShip={async (state) => {
                const pr = await client.ship(app.id, { state });
                await refresh();
                return pr;
              }}
            />
          )}
          <NeedsYouMenu status={status} href={(a, c) => `/studio/${a}?chat=${c}`} />
          <AppSettingsLink appId={appId} />
        </div>
      </header>
      <div className="flex shrink-0 border-b p-1.5 lg:hidden" role="tablist" aria-label="Pane">
        {(["chat", "preview"] as const).map((p) => (
          <button
            key={p}
            type="button"
            role="tab"
            aria-selected={pane === p}
            onClick={() => setPane(p)}
            className={cn(
              "flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md text-sm text-muted-foreground",
              pane === p && "bg-muted font-medium text-foreground",
            )}
          >
            {p === "chat" ? <MessageSquare className="size-4" /> : <Eye className="size-4" />}
            {p === "chat" ? "Chat" : "Preview"}
          </button>
        ))}
      </div>
      <div className="flex min-h-0 flex-1">
        <aside className={cn("min-h-0 w-full shrink-0 border-r lg:block lg:w-[400px] xl:w-[440px]", pane === "chat" ? "block" : "hidden")}>{rail}</aside>
        <section aria-label="Preview" className={cn("min-h-0 min-w-0 flex-1 lg:block", pane === "preview" ? "block" : "hidden")}>
          <PreviewPane
            preview={preview}
            error={previewError}
            reload={finished}
            routes={routes}
            view={view}
            onViewChange={setView}
            loadDiff={loadDiff}
            diffKey={previewVersion ?? chatId ?? ""}
            onRestart={target ? restartPreview : undefined}
            banner={
              previewing ? (
                <PreviewingBanner
                  version={previewing}
                  number={versionNumber(versions, previewing.id)}
                  onRestore={() => restore(previewing)}
                  onBack={() => setPreviewVersion(undefined)}
                />
              ) : undefined
            }
          >
            {!app ? (
              <EmptyPreview starting />
            ) : importing ? (
              <SetupPanel
                app={app}
                steps={steps}
                preview={preview}
                onDevCommand={async (devCommand) => {
                  await client.updateApp(app.id, { devCommand });
                  await refresh();
                  // A running dev server keeps its command until it starts again.
                  if (target) await restartPreview();
                }}
                onRestart={restartPreview}
                failedActions={app.status === "failed" ? <FailedAppActions app={app} onRetry={retryApp} onDelete={deleteApp} /> : undefined}
              />
            ) : app.status === "failed" ? (
              <FailedApp app={app} onRetry={retryApp} onDelete={deleteApp} />
            ) : app.status === "creating" ? (
              <EmptyPreview starting />
            ) : !target ? (
              <EmptyPreview />
            ) : undefined}
          </PreviewPane>
        </section>
      </div>
    </div>
  );
}
