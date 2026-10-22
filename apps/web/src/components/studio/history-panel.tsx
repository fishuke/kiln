"use client";

import { Bookmark, GitCommitHorizontal, Sparkles, Undo2, X } from "lucide-react";
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { relativeTime } from "@/lib/run-tree";
import { groupByDay, versionNumber } from "@/lib/studio/model";
import type { Version } from "@/lib/studio/types";
import { cn } from "@/lib/utils";

const KIND_ICON = { initial: Sparkles, apply: GitCommitHorizontal, restore: Undo2 } as const;

function VersionRow({
  v,
  n,
  latest,
  previewing,
  onPreview,
  onBookmark,
}: {
  v: Version;
  n: number;
  latest: boolean;
  previewing: boolean;
  onPreview: () => void;
  onBookmark: (on: boolean) => void;
}) {
  const Icon = KIND_ICON[v.kind];
  return (
    <li
      className={cn(
        "group/row flex items-center gap-1 rounded-lg pr-1 transition-colors hover:bg-muted",
        previewing && "bg-violet-500/10 hover:bg-violet-500/15",
      )}
    >
      <button
        type="button"
        onClick={onPreview}
        aria-current={previewing ? "true" : undefined}
        className="flex min-w-0 flex-1 items-start gap-2.5 rounded-lg px-2 py-2 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md border bg-background text-muted-foreground">
          <Icon className="size-3.5" />
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="line-clamp-2 text-sm font-medium">{v.title}</span>
          <span className="text-xs text-muted-foreground" suppressHydrationWarning>
            v{n} · {relativeTime(v.createdAt)}
            {latest && <span className="ml-1.5 rounded-sm bg-emerald-500/15 px-1 py-px font-medium text-emerald-700 dark:text-emerald-400">Current</span>}
            {previewing && <span className="ml-1.5 rounded-sm bg-violet-500/15 px-1 py-px font-medium text-violet-700 dark:text-violet-300">Previewing</span>}
          </span>
        </span>
      </button>
      <Button
        size="icon-sm"
        variant="ghost"
        aria-pressed={v.bookmarked}
        aria-label={v.bookmarked ? `Remove bookmark from v${n}` : `Bookmark v${n}`}
        onClick={() => onBookmark(!v.bookmarked)}
        className={cn(!v.bookmarked && "opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100")}
      >
        <Bookmark className={cn(v.bookmarked && "fill-current text-amber-500")} />
      </Button>
    </li>
  );
}

function VersionList({
  versions,
  all,
  previewing,
  onPreview,
  onBookmark,
  empty,
}: {
  versions: Version[];
  all: Version[];
  previewing?: string;
  onPreview: (v: Version) => void;
  onBookmark: (v: Version, on: boolean) => void;
  empty: React.ReactNode;
}) {
  const groups = useMemo(() => groupByDay(versions, new Date()), [versions]);
  const latest = all.reduce<Version | undefined>((a, v) => (!a || v.createdAt > a.createdAt ? v : a), undefined);
  if (!versions.length) return <div className="px-4 py-10 text-center text-sm text-muted-foreground">{empty}</div>;
  return (
    <div className="flex flex-col gap-4 px-2 pb-4">
      {groups.map((g) => (
        <section key={g.label}>
          <h3 className="px-2 pb-1 text-xs font-medium text-muted-foreground">{g.label}</h3>
          <ul className="flex flex-col">
            {g.versions.map((v) => (
              <VersionRow
                key={v.id}
                v={v}
                n={versionNumber(all, v.id)}
                latest={v.id === latest?.id}
                previewing={v.id === previewing}
                onPreview={() => onPreview(v)}
                onBookmark={(on) => onBookmark(v, on)}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** History and Bookmarks: every version of the app, newest first; pick one to preview it. */
export function HistoryPanel({
  versions,
  previewing,
  onPreview,
  onBookmark,
  onClose,
}: {
  versions: Version[];
  previewing?: string;
  onPreview: (v: Version) => void;
  onBookmark: (v: Version, on: boolean) => void;
  onClose: () => void;
}) {
  const bookmarks = versions.filter((v) => v.bookmarked);
  return (
    <Tabs defaultValue="history" className="flex h-full min-h-0 flex-col gap-0">
      <div className="flex h-12 shrink-0 items-center gap-2 px-3">
        <TabsList>
          <TabsTrigger value="history">History</TabsTrigger>
          <TabsTrigger value="bookmarks">
            Bookmarks
            {bookmarks.length > 0 && <span className="rounded-full bg-muted px-1.5 text-[11px] tabular-nums">{bookmarks.length}</span>}
          </TabsTrigger>
        </TabsList>
        <Button size="icon-sm" variant="ghost" aria-label="Close history" onClick={onClose} className="ml-auto">
          <X />
        </Button>
      </div>
      <TabsContent value="history" className="min-h-0 overflow-y-auto">
        <VersionList
          versions={versions}
          all={versions}
          previewing={previewing}
          onPreview={onPreview}
          onBookmark={onBookmark}
          empty="No versions yet. Each change you keep becomes one."
        />
      </TabsContent>
      <TabsContent value="bookmarks" className="min-h-0 overflow-y-auto">
        <VersionList
          versions={bookmarks}
          all={versions}
          previewing={previewing}
          onPreview={onPreview}
          onBookmark={onBookmark}
          empty="Bookmark a version to find it here."
        />
      </TabsContent>
    </Tabs>
  );
}
