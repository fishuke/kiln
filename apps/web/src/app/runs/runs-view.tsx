"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowDownWideNarrow, ArrowUpNarrowWide, Bot, Building2, Calendar, ChevronDown, ChevronRight, Circle, ImageIcon, ListFilter, Route, SlidersHorizontal, User, X } from "lucide-react";
import { useEffect, useMemo, useState, useTransition } from "react";
import { ConfirmAction } from "@/components/kiln/confirm-action";
import { DateRangePicker, formatRange } from "@/components/kiln/date-range-picker";
import { HeaderIconButton, HeaderSearch, MenuSearch } from "@/components/kiln/header-controls";
import { AgentIcon, Chip, PersonAvatar, SourceIcon, StatusGlyph, StatusSquare, personName } from "@/components/kiln/run-visuals";
import { GitHubIcon } from "@/components/kiln/brand-icons";
import { PageHeader } from "@/components/kiln/ui";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { agentDisplayName, filterRows, mediaChipLabel, parseRunFilters, relativeTime, runFiltersToQuery, RUN_STATUSES, SOURCES, sourceLabel, STATUS_LABEL, type RunFilters, type RunRow, type RunStatus, type SortKey } from "@/lib/run-tree";
import { cn } from "@/lib/utils";
import { stopRun } from "./actions";
import { RunContextMenu } from "./run-context-menu";
import { SetupPanel, SetupRing, type SetupTask } from "./setup-panel";

type FactoryOpt = { id: string; name: string; alias: string };
const SETUP_KEY = "kiln.runs.setup";
const QUICK: { key: "mine" | RunStatus; label: string }[] = [{ key: "mine", label: "My runs" }, ...RUN_STATUSES.map((s) => ({ key: s, label: STATUS_LABEL[s] }))];

export function RunsView({ rows, me, factories, setup }: { rows: RunRow[]; me: string; factories: FactoryOpt[]; setup: SetupTask[] }) {
  const router = useRouter();
  const sp = useSearchParams();
  const [, startTransition] = useTransition();
  const filters = useMemo(() => parseRunFilters(new URLSearchParams(sp.toString())), [sp]);
  const createdChip = sp.has("createdOn");
  const [q, setQ] = useState(filters.q ?? "");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [setupOpen, setSetupOpen] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [cancelling, setCancelling] = useState<{ row: RunRow; isWorkItem: boolean } | null>(null);

  useEffect(() => {
    try {
      setSetupOpen(localStorage.getItem(SETUP_KEY) !== "closed");
    } catch {
      /* storage unavailable */
    }
  }, []);

  const update = (next: Partial<RunFilters>, opts: { createdChip?: boolean } = {}) => {
    const merged = { ...filters, ...next };
    startTransition(() => router.replace(`/runs${runFiltersToQuery(merged, { createdChip: opts.createdChip ?? createdChip })}`, { scroll: false }));
  };

  // Debounce search into the URL.
  useEffect(() => {
    if ((filters.q ?? "") === q) return;
    const t = setTimeout(() => update({ q: q || undefined }), 200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const shown = useMemo(() => filterRows(rows, { ...filters, me }), [rows, filters, me]);
  const agents = useMemo(() => [...new Set(collectAgents(rows))].sort(), [rows]);
  const creators = useMemo(() => [...new Set(rows.map((r) => r.creator).filter(Boolean))].sort(), [rows]);

  const toggleList = <T extends string>(list: T[] | undefined, v: T): T[] => (list?.includes(v) ? list.filter((x) => x !== v) : [...(list ?? []), v]);
  const isActive = (k: "mine" | RunStatus) => (k === "mine" ? Boolean(filters.mine) : Boolean(filters.status?.includes(k)));
  const toggleQuick = (k: "mine" | RunStatus) => (k === "mine" ? update({ mine: !filters.mine }) : update({ status: toggleList(filters.status, k) }));
  const active = QUICK.filter((x) => isActive(x.key));
  const inactive = QUICK.filter((x) => !isActive(x.key));
  const range = formatRange(filters.from, filters.to);
  const doneCount = setup.filter((t) => t.done).length;
  const alias = factories[0]?.alias ?? "factory";

  const toggleSetup = () => {
    const next = !setupOpen;
    setSetupOpen(next);
    try {
      localStorage.setItem(SETUP_KEY, next ? "open" : "closed");
    } catch {
      /* storage unavailable */
    }
  };

  return (
    <div className="flex min-h-screen flex-col">
      <PageHeader
        crumbs={[{ label: "Runs" }]}
        actions={
          <>
            <HeaderSearch value={q} onChange={setQ} placeholder="Search runs..." />
            <SortMenu sort={filters.sort ?? "updated"} dir={filters.dir ?? "desc"} onChange={(sort, dir) => update({ sort, dir })} />
            <FilterMenu
              filters={filters}
              agents={agents}
              creators={creators}
              factories={factories}
              me={me}
              onChange={update}
              onCreatedOn={() => {
                update({}, { createdChip: true });
                setTimeout(() => setPickerOpen(true), 50);
              }}
            />
            <button type="button" onClick={toggleSetup} aria-pressed={setupOpen} className="flex h-8 items-center gap-1.5 rounded-md border bg-background px-3 text-sm font-semibold hover:bg-muted dark:bg-muted/20">
              <SetupRing done={doneCount} total={setup.length} />
              Setup
            </button>
          </>
        }
      />
      <div className="flex flex-1">
        <div className="min-w-0 flex-1">
          <div className={cn("flex flex-wrap items-center gap-1.5 px-3 py-2", !setupOpen && "border-b")}>
            <button type="button" aria-label="Clear quick filters" onClick={() => update({ mine: false, status: [] })} className="flex size-6 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground">
              <X className="size-4" />
            </button>
            {(active.length > 0 || createdChip) && (
              <span className="flex items-center">
                {active.map((x, i) => (
                  <button
                    key={x.key}
                    type="button"
                    aria-pressed
                    onClick={() => toggleQuick(x.key)}
                    className={cn("h-6 px-2.5 text-xs font-medium text-white", i === 0 ? "rounded-l-full bg-black dark:bg-white dark:text-black" : "bg-neutral-700 dark:bg-neutral-300 dark:text-black", i === active.length - 1 && !createdChip && "rounded-r-full", "border-r border-white/10")}
                  >
                    {x.label}
                  </button>
                ))}
                {createdChip && (
                  <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
                    <span className={cn("flex h-6 items-center gap-1 rounded-r-full bg-neutral-700 pr-1.5 pl-2 text-xs font-medium text-white dark:bg-neutral-300 dark:text-black", active.length === 0 && "rounded-l-full")}>
                      <PopoverTrigger className="flex items-center gap-1.5">
                        <Calendar className="size-3.5" />
                        <span className={cn(!range && "text-white/50 dark:text-black/50")}>{range ?? "Select dates"}</span>
                      </PopoverTrigger>
                      <button type="button" aria-label="Remove Created filter" onClick={() => update({ from: undefined, to: undefined }, { createdChip: false })} className="flex size-4 items-center justify-center rounded-full hover:bg-white/20">
                        <X className="size-3" />
                      </button>
                    </span>
                    <PopoverContent align="start" className="w-auto p-0">
                      <DateRangePicker
                        from={filters.from}
                        to={filters.to}
                        onCancel={() => setPickerOpen(false)}
                        onApply={(r) => {
                          setPickerOpen(false);
                          update({ from: r.from, to: r.to }, { createdChip: true });
                        }}
                      />
                    </PopoverContent>
                  </Popover>
                )}
              </span>
            )}
            {inactive.map((x) => (
              <button key={x.key} type="button" aria-pressed={false} onClick={() => toggleQuick(x.key)} className="h-6 rounded-full bg-muted/60 px-2.5 text-xs font-medium text-foreground/80 hover:bg-muted">
                {x.label}
              </button>
            ))}
          </div>
          <div className="px-3 pb-6">
            {shown.length === 0 ? (
              <div className="mt-3 flex min-h-[calc(100vh-150px)] flex-col items-center justify-center rounded-xl bg-muted/60 px-6 text-center">
                <div className="text-base font-semibold text-foreground/80">No runs found</div>
                <p className="mt-0.5 text-sm text-muted-foreground">No runs match the current filters. Try adjusting your search or filter criteria.</p>
              </div>
            ) : (
              <ul className="flex flex-col">
                {shown.map((r) => (
                  <RunTreeRow key={r.id} row={r} depth={0} expanded={expanded} onToggle={(id) => setExpanded((s) => toggleSet(s, id))} onCancel={(row, isWorkItem) => setCancelling({ row, isWorkItem })} />
                ))}
              </ul>
            )}
          </div>
        </div>
        {setupOpen && <SetupPanel tasks={setup} alias={alias} />}
      </div>
      <ConfirmAction
        open={cancelling !== null}
        onOpenChange={(o) => !o && setCancelling(null)}
        title="Cancel this run?"
        description={cancelling && (cancelling.isWorkItem ? <>“{cancelling.row.title}” and every agent working on it will stop.</> : <>The agent working on “{cancelling.row.title}” will stop.</>)}
        confirmLabel="Cancel run"
        cancelLabel="Keep running"
        action={() => stopRun({ id: cancelling!.row.id, isWorkItem: cancelling!.isWorkItem })}
        success="Run cancelled"
      />
    </div>
  );
}

export function RunsLoading() {
  return (
    <div className="space-y-2 p-3" aria-label="Loading runs...">
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-12 w-full rounded-lg" />
      ))}
    </div>
  );
}

function toggleSet(s: Set<string>, id: string) {
  const n = new Set(s);
  if (n.has(id)) n.delete(id);
  else n.add(id);
  return n;
}

function collectAgents(rows: RunRow[]): string[] {
  return rows.flatMap((r) => [r.agent, ...collectAgents(r.children)]);
}

function RunTreeRow({ row, depth, expanded, onToggle, onCancel }: { row: RunRow; depth: number; expanded: Set<string>; onToggle: (id: string) => void; onCancel: (row: RunRow, isWorkItem: boolean) => void }) {
  const open = expanded.has(row.id);
  const hasKids = row.children.length > 0;
  const href = depth > 0 ? `${row.href}?tab=agents&from=parent` : row.href;
  const media = mediaChipLabel(row.images, row.videos);
  const count = countAll(row.children);
  return (
    <li>
      <RunContextMenu
        row={row}
        href={href}
        onCancel={(r) => onCancel(r, depth === 0)}
        className={cn("group/row relative flex h-12 items-center gap-3 rounded-lg px-2 transition-colors hover:bg-foreground/5 data-popup-open:bg-foreground/[0.07]", open && "bg-foreground/5")}
        style={{ paddingLeft: 8 + depth * 40 }}
      >
        <Link href={href} className="absolute inset-0 rounded-lg" aria-label={row.title} />
        {hasKids ? (
          <button type="button" aria-label={open ? "Collapse children" : "Expand children"} aria-expanded={open} onClick={() => onToggle(row.id)} className="relative z-10 size-6 shrink-0">
            <span className={cn("absolute inset-0 transition-opacity", open ? "opacity-0" : "group-hover/row:opacity-0")}>
              <StatusSquare status={row.status} />
              <span aria-label={`${count} child runs`} className="absolute -right-1 -bottom-1 flex size-3.5 items-center justify-center rounded-full bg-black text-[9px] font-semibold text-white ring-1 ring-background dark:bg-white dark:text-black">
                {count}
              </span>
            </span>
            <span className={cn("absolute inset-0 flex items-center justify-center rounded-[5px] bg-foreground/[0.07] text-muted-foreground transition-opacity", open ? "opacity-100" : "opacity-0 group-hover/row:opacity-100")}>
              {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
            </span>
          </button>
        ) : (
          <StatusSquare status={row.status} className="relative" />
        )}
        <span className="pointer-events-none relative min-w-0 flex-1 truncate text-sm font-medium">{row.title}</span>
        <span className="relative flex shrink-0 items-center gap-3">
          <span className="flex items-center [&>*+*]:-ml-6 [&>*+*]:transition-[margin] [&>*+*]:duration-300 [&>*+*]:ease-[cubic-bezier(0.34,1.56,0.64,1)] group-hover/row:[&>*+*]:ml-1">
            {row.prUrl && (
              <a href={row.prUrl} target="_blank" rel="noreferrer" className="relative z-10 max-w-28 hover:z-20">
                <Chip className="hover:bg-muted">
                  <GitHubIcon className="size-3.5" />
                  PR Created
                </Chip>
              </a>
            )}
            {media && (
              <Link href={`${row.href}?tab=artifacts`} className="relative z-10 max-w-36 hover:z-20">
                <Chip className="hover:bg-muted">
                  <ImageIcon className="size-3.5 text-purple-500" />
                  {media}
                </Chip>
              </Link>
            )}
            <span className="relative z-10">
              <Chip>
                <SourceIcon source={row.source} />
                {sourceLabel(row.source)}
              </Chip>
            </span>
          </span>
          <span className="pointer-events-none">
            <PersonAvatar name={row.creator || "Kiln"} />
            <span className="sr-only">Created by {personName(row.creator || "kiln")}</span>
          </span>
          <span className="pointer-events-none min-w-[100px] text-right text-xs text-muted-foreground" suppressHydrationWarning>
            {relativeTime(row.updatedAt)}
          </span>
        </span>
      </RunContextMenu>
      {hasKids && open && (
        <ul>
          {row.children.map((c) => (
            <RunTreeRow key={c.id} row={c} depth={depth + 1} expanded={expanded} onToggle={onToggle} onCancel={onCancel} />
          ))}
        </ul>
      )}
    </li>
  );
}

function countAll(rows: RunRow[]): number {
  return rows.reduce((n, r) => n + 1 + countAll(r.children), 0);
}

function SortMenu({ sort, dir, onChange }: { sort: SortKey; dir: "asc" | "desc"; onChange: (s: SortKey, d: "asc" | "desc") => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<HeaderIconButton aria-label="Sort" />}>
        <SlidersHorizontal />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-50">
        <DropdownMenuRadioGroup value={sort} onValueChange={(v) => onChange(v as SortKey, dir)}>
          {(["updated", "created", "title", "agent"] as const).map((k) => (
            <DropdownMenuRadioItem key={k} value={k} className="h-9 px-2 [&_[data-slot=dropdown-menu-radio-item-indicator]_svg]:text-violet-600">
              {k.charAt(0).toUpperCase() + k.slice(1)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <div role="tablist" aria-label="Sort direction" className="m-1 grid grid-cols-2 gap-1 rounded-md bg-muted/70 p-0.5">
          {(["asc", "desc"] as const).map((d) => (
            <button key={d} type="button" role="tab" aria-selected={dir === d} aria-label={d === "asc" ? "Sort ascending" : "Sort descending"} onClick={() => onChange(sort, d)} className={cn("flex h-7 items-center justify-center rounded text-muted-foreground", dir === d && "bg-foreground/10 text-foreground")}>
              {d === "asc" ? <ArrowUpNarrowWide className="size-4" /> : <ArrowDownWideNarrow className="size-4" />}
            </button>
          ))}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function FilterMenu({
  filters,
  agents,
  creators,
  factories,
  me,
  onChange,
  onCreatedOn,
}: {
  filters: RunFilters;
  agents: string[];
  creators: string[];
  factories: FactoryOpt[];
  me: string;
  onChange: (f: Partial<RunFilters>) => void;
  onCreatedOn: () => void;
}) {
  const [agentQ, setAgentQ] = useState("");
  const [factoryQ, setFactoryQ] = useState("");
  const [creatorQ, setCreatorQ] = useState("");
  const toggle = <T extends string>(list: T[] | undefined, v: T): T[] => (list?.includes(v) ? list.filter((x) => x !== v) : [...(list ?? []), v]);
  const itemCls = "h-9 px-2 [&_[data-slot=dropdown-menu-checkbox-item-indicator]_svg]:text-violet-600";
  const defaultFactory = factories.length === 1 ? factories[0]!.name : undefined;
  const creatorChecked = (c: string) => Boolean(filters.creator?.includes(c)) || (c === me && Boolean(filters.mine));
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<HeaderIconButton aria-label="Filter" />}>
        <ListFilter />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-62">
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="h-9 px-2">
            <Circle className="text-muted-foreground" />
            Status
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-56">
            {RUN_STATUSES.map((s) => (
              <DropdownMenuCheckboxItem key={s} checked={Boolean(filters.status?.includes(s))} onCheckedChange={() => onChange({ status: toggle(filters.status, s) })} className={itemCls}>
                <StatusGlyph status={s} className={s === "complete" ? "text-emerald-600" : undefined} />
                {STATUS_LABEL[s]}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="h-9 px-2">
            <Bot className="text-muted-foreground" />
            Agent
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="max-h-96 w-62">
            <MenuSearch value={agentQ} onChange={setAgentQ} placeholder="Search agents" />
            {agents
              .filter((a) => agentDisplayName(a, defaultFactory).toLowerCase().includes(agentQ.toLowerCase()))
              .map((a) => (
                <DropdownMenuCheckboxItem key={a} checked={Boolean(filters.agent?.includes(a))} onCheckedChange={() => onChange({ agent: toggle(filters.agent, a) })} className={itemCls}>
                  <AgentIcon agent={a} />
                  <span className="truncate">{agentDisplayName(a, defaultFactory)}</span>
                </DropdownMenuCheckboxItem>
              ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="h-9 px-2">
            <Building2 className="text-muted-foreground" />
            Factory
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="max-h-96 w-62">
            <MenuSearch value={factoryQ} onChange={setFactoryQ} placeholder="Search factories" />
            <DropdownMenuItem className="h-9 px-2 text-muted-foreground" disabled={!filters.factory?.length} closeOnClick={false} onClick={() => onChange({ factory: [] })}>
              Deselect all factories
            </DropdownMenuItem>
            {factories
              .filter((f) => f.name.toLowerCase().includes(factoryQ.toLowerCase()))
              .map((f) => (
                <DropdownMenuCheckboxItem key={f.id} checked={Boolean(filters.factory?.includes(f.id))} onCheckedChange={() => onChange({ factory: toggle(filters.factory, f.id) })} className={itemCls}>
                  {f.name}
                </DropdownMenuCheckboxItem>
              ))}
            {factories.length === 0 && <div className="px-2 py-2 text-sm text-muted-foreground">No options</div>}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="h-9 px-2">
            <Route className="text-muted-foreground" />
            Source
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="max-h-[70vh] w-62">
            {SOURCES.map((s) => (
              <DropdownMenuCheckboxItem key={s} checked={Boolean(filters.source?.includes(s))} onCheckedChange={() => onChange({ source: toggle(filters.source, s) })} className={itemCls}>
                <SourceIcon source={s} className="size-4" />
                {sourceLabel(s)}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="h-9 px-2">
            <User className="text-muted-foreground" />
            Creator
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="max-h-96 w-62">
            <MenuSearch value={creatorQ} onChange={setCreatorQ} placeholder="Search creators" />
            {[...new Set([me, ...creators])]
              .filter((c) => c && personName(c).toLowerCase().includes(creatorQ.toLowerCase()))
              .map((c) => (
                <DropdownMenuCheckboxItem
                  key={c}
                  checked={creatorChecked(c)}
                  onCheckedChange={() => (c === me && filters.mine ? onChange({ mine: false }) : onChange({ creator: toggle(filters.creator, c) }))}
                  className={itemCls}
                >
                  <PersonAvatar name={c} size={18} />
                  {personName(c)}
                </DropdownMenuCheckboxItem>
              ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuItem className="h-9 px-2" onClick={onCreatedOn}>
          <Calendar className="text-muted-foreground" />
          Created on
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
