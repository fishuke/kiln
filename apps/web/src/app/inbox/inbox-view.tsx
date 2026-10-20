"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCheck, CircleAlert, CircleHelp, ExternalLink, FileText, GitPullRequest, ListFilter, Mail, MailOpen, MessageSquareReply, Square, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { FactoryAvatar } from "@/components/kiln/sidebar";
import { GateCard } from "@/components/kiln/gate-card";
import { HeaderIconButton, HeaderSearch, MenuSearch } from "@/components/kiln/header-controls";
import { Markdown } from "@/components/kiln/markdown";
import { Chip } from "@/components/kiln/run-visuals";
import { PageHeader } from "@/components/kiln/ui";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { filterInbox, INBOX_KIND_LABEL, INBOX_KINDS, primaryAction, type InboxEntry, type InboxKind } from "@/lib/inbox-model";
import type { GateView } from "@/lib/run-detail";
import { relativeTime } from "@/lib/run-tree";
import { cn } from "@/lib/utils";
import { markItems } from "./actions";

type FactoryOpt = { id: string; name: string };
const READ_KEY = "kiln.inbox.read";

const KIND_ICON: Record<InboxKind, React.ComponentType<{ className?: string }>> = {
  question: CircleHelp,
  answer_question: MessageSquareReply,
  spec_review: FileText,
  pr_review: GitPullRequest,
  blocked: Square,
  failed: CircleAlert,
};
const KIND_TONE: Record<InboxKind, string> = {
  question: "text-violet-600 dark:text-violet-400",
  answer_question: "text-muted-foreground",
  spec_review: "text-amber-600 dark:text-amber-400",
  pr_review: "text-emerald-600 dark:text-emerald-400",
  blocked: "text-orange-600 dark:text-orange-400",
  failed: "text-pink-600 dark:text-pink-400",
};

function loadLocalRead(): Record<string, boolean> {
  try {
    return JSON.parse(sessionStorage.getItem(READ_KEY) ?? "{}") as Record<string, boolean>;
  } catch {
    return {};
  }
}

export function InboxView({ entries, gates, factories }: { entries: InboxEntry[]; gates: Record<string, GateView>; factories: FactoryOpt[] }) {
  const router = useRouter();
  const sp = useSearchParams();
  const [q, setQ] = useState("");
  const [factoryF, setFactoryF] = useState<string[]>([]);
  const [readF, setReadF] = useState<("read" | "unread")[]>(["read", "unread"]);
  const [kindF, setKindF] = useState<InboxKind[]>(INBOX_KINDS);
  const [factoryQ, setFactoryQ] = useState("");
  const [readOverride, setReadOverride] = useState<Record<string, boolean>>({});
  const [resolved, setResolved] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selecting, setSelecting] = useState(false);
  const openId = sp.get("item");

  useEffect(() => setReadOverride(loadLocalRead()), []);

  const items = useMemo(() => entries.filter((e) => !resolved.has(e.id)).map((e) => (e.id in readOverride ? { ...e, read: readOverride[e.id]! } : e)), [entries, resolved, readOverride]);
  const shown = useMemo(() => filterInbox(items, { factory: factoryF.length ? factoryF : undefined, read: readF, kind: kindF, q }), [items, factoryF, readF, kindF, q]);
  const open = items.find((e) => e.id === openId || e.gateId === openId);

  const setRead = (ids: string[], read: boolean, quiet = false) => {
    setReadOverride((prev) => {
      const next = { ...prev };
      for (const id of ids) next[id] = read;
      try {
        sessionStorage.setItem(READ_KEY, JSON.stringify(next));
      } catch {
        /* storage unavailable */
      }
      return next;
    });
    void markItems(read ? "read" : "unread", ids).then(() => !quiet && toast.success(read ? `Marked ${ids.length === 1 ? "" : `${ids.length} items `}as read` : `Marked ${ids.length === 1 ? "" : `${ids.length} items `}as unread`));
  };

  const select = (id: string | null) => {
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("item", id);
    else url.searchParams.delete("item");
    router.replace(`${url.pathname}${url.search}`, { scroll: false });
  };

  // Opening an item marks it read.
  useEffect(() => {
    if (open && !open.read) setRead([open.id], true, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open?.id]);

  /** Resolve hides the items at once; the API call waits for the Undo window to pass. */
  const resolve = (ids: string[]) => {
    setResolved((s) => new Set([...s, ...ids]));
    setSelected(new Set());
    if (open && ids.includes(open.id)) select(null);
    let undone = false;
    toast(ids.length === 1 ? "Resolved" : `Resolved ${ids.length} items`, {
      action: {
        label: "Undo",
        onClick: () => {
          undone = true;
          setResolved((s) => {
            const n = new Set(s);
            for (const id of ids) n.delete(id);
            return n;
          });
        },
      },
      onAutoClose: () => !undone && void markItems("resolve", ids),
      onDismiss: () => !undone && void markItems("resolve", ids),
    });
  };

  const toggleSel = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const itemCls = "h-9 px-2 [&_[data-slot=dropdown-menu-checkbox-item-indicator]_svg]:text-violet-600";
  const factoryName = (id: string) => factories.find((f) => f.id === id)?.name ?? id;

  return (
    <div className="flex h-screen flex-col">
      <PageHeader
        crumbs={[{ label: "Inbox" }]}
        actions={
          <>
            {selecting && selected.size > 0 && (
              <>
                <Button variant="outline" size="sm" onClick={() => setRead([...selected], true)}>
                  <MailOpen /> Mark read
                </Button>
                <Button variant="outline" size="sm" onClick={() => setRead([...selected], false)}>
                  <Mail /> Mark unread
                </Button>
                <Button variant="outline" size="sm" onClick={() => resolve([...selected])}>
                  <CheckCheck /> Resolve
                </Button>
              </>
            )}
            <HeaderSearch value={q} onChange={setQ} placeholder="Search inbox..." />
            <DropdownMenu>
              <DropdownMenuTrigger render={<HeaderIconButton aria-label="Filter" />}>
                <ListFilter />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-62">
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger className="h-9 px-2">Factory</DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="w-56">
                    <MenuSearch value={factoryQ} onChange={setFactoryQ} placeholder="Search factories" />
                    {factories
                      .filter((f) => f.name.toLowerCase().includes(factoryQ.toLowerCase()))
                      .map((f) => (
                        <DropdownMenuCheckboxItem key={f.id} checked={factoryF.includes(f.id)} onCheckedChange={() => setFactoryF(toggle(factoryF, f.id))} className={itemCls}>
                          <FactoryAvatar name={f.name} />
                          {f.name}
                        </DropdownMenuCheckboxItem>
                      ))}
                    {factories.length === 0 && <div className="px-2 py-2 text-sm text-muted-foreground opacity-50">No options</div>}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger className="h-9 px-2">Read</DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="w-48">
                    {(["unread", "read"] as const).map((r) => (
                      <DropdownMenuCheckboxItem key={r} checked={readF.includes(r)} onCheckedChange={() => setReadF(toggle(readF, r))} className={itemCls}>
                        {r === "read" ? "Read" : "Unread"}
                      </DropdownMenuCheckboxItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger className="h-9 px-2">Type</DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="w-56">
                    {INBOX_KINDS.map((k) => (
                      <DropdownMenuCheckboxItem key={k} checked={kindF.includes(k)} onCheckedChange={() => setKindF(toggle(kindF, k))} className={itemCls}>
                        {INBOX_KIND_LABEL[k]}
                      </DropdownMenuCheckboxItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              </DropdownMenuContent>
            </DropdownMenu>
            <button
              type="button"
              disabled={items.length === 0}
              onClick={() => {
                if (selecting && selected.size === shown.length) {
                  setSelecting(false);
                  setSelected(new Set());
                } else {
                  setSelecting(true);
                  setSelected(new Set(shown.map((e) => e.id)));
                }
              }}
              className="h-8 rounded-md bg-foreground/5 px-3 text-sm font-semibold text-muted-foreground hover:bg-foreground/10 hover:text-foreground disabled:pointer-events-none disabled:opacity-60"
            >
              {selecting && selected.size === shown.length && shown.length > 0 ? "Deselect all" : "Select all"}
            </button>
          </>
        }
      />
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 overflow-y-auto">
          {items.length === 0 ? (
            <EmptyInbox />
          ) : shown.length === 0 ? (
            <div className="flex flex-col items-center py-32 text-center">
              <div className="text-sm font-semibold">Nothing matches</div>
              <p className="mt-1 text-xs text-muted-foreground">No inbox items match the current search or filters.</p>
            </div>
          ) : (
            <ul className="flex flex-col p-2">
              {shown.map((e) => {
                const Icon = KIND_ICON[e.kind];
                return (
                  <li key={e.id}>
                    <div className={cn("group/row relative flex h-14 items-center gap-3 rounded-lg px-3 hover:bg-foreground/5", open?.id === e.id && "bg-foreground/5")}>
                      <button type="button" className="absolute inset-0 rounded-lg" aria-label={e.title} onClick={() => select(e.gateId ?? e.id)} />
                      {selecting ? (
                        <Checkbox checked={selected.has(e.id)} onCheckedChange={() => toggleSel(e.id)} aria-label={`Select ${e.title}`} className="relative z-10" />
                      ) : (
                        <span className={cn("size-2 shrink-0 rounded-full", e.read ? "bg-transparent" : "bg-violet-500")} aria-label={e.read ? "Read" : "Unread"} />
                      )}
                      <Icon className={cn("pointer-events-none relative size-4 shrink-0", KIND_TONE[e.kind])} />
                      <div className="pointer-events-none relative min-w-0 flex-1">
                        <div className={cn("truncate text-sm", e.read ? "text-muted-foreground" : "font-medium")}>{e.title}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {INBOX_KIND_LABEL[e.kind]} · {factoryName(e.factory)}
                          {e.workItemTitle && e.workItemTitle !== e.title ? ` · ${e.workItemTitle}` : ""}
                        </div>
                      </div>
                      {e.urgent && <Chip className="pointer-events-none relative border-orange-500/30 text-orange-700 dark:text-orange-300">Urgent</Chip>}
                      <span className="pointer-events-none relative w-28 shrink-0 text-right text-xs text-muted-foreground group-hover/row:hidden" suppressHydrationWarning>
                        {relativeTime(e.at)}
                      </span>
                      <span className="relative z-10 hidden w-28 shrink-0 justify-end gap-1 group-hover/row:flex">
                        <button type="button" aria-label={e.read ? "Mark as unread" : "Mark as read"} title={e.read ? "Mark as unread" : "Mark as read"} onClick={() => setRead([e.id], !e.read)} className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground">
                          {e.read ? <Mail className="size-4" /> : <MailOpen className="size-4" />}
                        </button>
                        <button type="button" aria-label="Resolve" title="Resolve" onClick={() => resolve([e.id])} className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground">
                          <CheckCheck className="size-4" />
                        </button>
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        {open && <InboxPane entry={open} gate={open.gateId ? gates[open.gateId] : undefined} factoryName={factoryName(open.factory)} onClose={() => select(null)} onResolve={() => resolve([open.id])} onToggleRead={() => setRead([open.id], !open.read)} />}
      </div>
    </div>
  );
}

function InboxPane({ entry, gate, factoryName, onClose, onResolve, onToggleRead }: { entry: InboxEntry; gate?: GateView; factoryName: string; onClose: () => void; onResolve: () => void; onToggleRead: () => void }) {
  const Icon = KIND_ICON[entry.kind];
  const runHref = `/runs/${entry.workItemId}`;
  return (
    <aside aria-label="Inbox item" className="flex w-[480px] shrink-0 flex-col border-l">
      <div className="flex h-12 shrink-0 items-center gap-1 border-b px-3">
        <span className="flex-1" />
        <button type="button" aria-label={entry.read ? "Mark as unread" : "Mark as read"} title={entry.read ? "Mark as unread" : "Mark as read"} onClick={onToggleRead} className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground">
          {entry.read ? <Mail className="size-4" /> : <MailOpen className="size-4" />}
        </button>
        <button type="button" aria-label="Resolve" title="Resolve" onClick={onResolve} className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground">
          <CheckCheck className="size-4" />
        </button>
        <button type="button" aria-label="Close" onClick={onClose} className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground">
          <X className="size-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <div className="flex flex-wrap gap-1.5">
          <Chip>
            <Icon className={cn("size-3.5", KIND_TONE[entry.kind])} />
            {INBOX_KIND_LABEL[entry.kind]}
          </Chip>
          <Chip>
            <FactoryAvatar name={factoryName} className="size-3.5" />
            {factoryName}
          </Chip>
          <Chip suppressHydrationWarning>{relativeTime(entry.at)}</Chip>
        </div>
        <h2 className="mt-3 text-base font-semibold">{entry.title}</h2>
        {entry.workItemTitle && entry.workItemTitle !== entry.title && (
          <Link href={runHref} className="mt-0.5 block text-sm text-muted-foreground hover:text-foreground">
            {entry.workItemTitle}
          </Link>
        )}
        <div className="mt-4">
          {gate && gate.state === "open" ? (
            <GateCard gate={gate} prUrl={entry.prUrl} previewUrl={entry.previewUrl} compact onDone={() => onResolve()} />
          ) : (
            <>
              {entry.body && <Markdown className="text-sm">{entry.body}</Markdown>}
              <div className="mt-4 flex flex-wrap gap-2">
                <Button nativeButton={false} render={<Link href={runHref} />}>{primaryAction(entry)}</Button>
                {entry.prUrl && (
                  <Button variant="outline" nativeButton={false} render={<a href={entry.prUrl} target="_blank" rel="noreferrer" />}>
                    <GitPullRequest /> View PR
                  </Button>
                )}
              </div>
            </>
          )}
        </div>
        <Link href={runHref} className="mt-6 inline-flex items-center gap-1.5 text-sm text-violet-600 hover:underline dark:text-violet-400">
          Open the run <ExternalLink className="size-3.5" />
        </Link>
      </div>
    </aside>
  );
}

function EmptyInbox() {
  return (
    <div className="flex flex-col items-center justify-center py-40 text-center">
      <DogIllustration />
      <div className="mt-3 text-sm font-semibold">No blocked runs</div>
      <p className="mt-1 text-xs text-muted-foreground">None of your agents are currently blocked. Go walk your dog!</p>
      <Button size="lg" className="mt-3 px-4" nativeButton={false} render={<Link href="/runs" />}>
        View runs
      </Button>
    </div>
  );
}

/** Sitting dog, grey line art. */
function DogIllustration() {
  return (
    <svg viewBox="0 0 64 64" className="size-16 text-muted-foreground/80" aria-hidden>
      <g fill="currentColor" stroke="var(--background)" strokeWidth="1.5" strokeLinejoin="round">
        <path d="M20 60c-4 0-6-3-4-6 2-4 6-6 8-12 1-4 1-9 4-13h10c2 4 2 9 1 14-1 4 1 8 3 11 2 3 0 6-3 6Z" />
        <path d="M30 8c6-3 14-1 16 6 1 4 3 6 2 9-1 4-6 6-11 6-6 0-10-3-11-8-1-5 0-11 4-13Z" />
        <path d="M30 9c-4 1-6 6-5 11 1 3 3 3 4 1 1-3 2-7 1-12Z" />
        <path d="M14 58c-3-1-4-5-1-8 2-2 5-1 6 2" />
      </g>
      <circle cx="40" cy="16" r="1.4" fill="var(--background)" />
      <path d="M44 22c-1 1-3 1-4 0" fill="none" stroke="var(--background)" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}
