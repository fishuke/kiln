"use client";

import { Bookmark, Eye, FileDiff, GitCommitHorizontal } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Item, ItemActions, ItemContent, ItemDescription, ItemFooter, ItemMedia, ItemTitle } from "@/components/ui/item";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { relativeTime } from "@/lib/run-tree";
import type { Version } from "@/lib/studio/types";
import { cn } from "@/lib/utils";
import { DiffView } from "./diff-view";

/** Details: a dialog with the change's File Tree and diff, loaded when it opens. */
export function DetailsDialog({
  open,
  onOpenChange,
  title,
  loadDiff,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  loadDiff: () => Promise<{ diff: string }>;
}) {
  const [diff, setDiff] = useState<string>();
  const [error, setError] = useState<string>();
  const load = useRef(loadDiff);
  load.current = loadDiff;
  useEffect(() => {
    if (!open) return;
    load
      .current()
      .then((d) => setDiff(d.diff))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [open]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[80vh] max-h-[720px] w-[min(1000px,calc(100vw-2rem))] max-w-none flex-col sm:max-w-none">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>What changed in this version.</DialogDescription>
        </DialogHeader>
        {error ? <p className="text-sm text-destructive">{error}</p> : <DiffView diff={diff} className="min-h-0 flex-1" />}
      </DialogContent>
    </Dialog>
  );
}

/**
 * The Checkpoint for a turn that changed files: its title, version number, **Details**, **Preview**
 * and a bookmark. Before Apply there is no version yet, so it says so and previews the chat.
 */
export function VersionCard({
  title,
  version,
  number,
  previewing,
  loadDiff,
  onPreview,
  onBookmark,
}: {
  title: string;
  version?: Version;
  number?: number;
  previewing: boolean;
  loadDiff: () => Promise<{ diff: string }>;
  onPreview: () => void;
  onBookmark?: (on: boolean) => void;
}) {
  const [details, setDetails] = useState(false);
  return (
    <Item variant="outline" size="sm" className={cn("bg-card shadow-xs", previewing && "border-violet-500/60 ring-3 ring-violet-500/15")}>
      <ItemMedia className="size-8 rounded-lg bg-violet-500/10 text-violet-600 dark:text-violet-400">
        <GitCommitHorizontal className="size-4" />
      </ItemMedia>
      <ItemContent className="min-w-0">
        <ItemTitle className="line-clamp-2">{title}</ItemTitle>
        <ItemDescription className="text-xs">
          {version ? (
            <>
              <span className="font-medium text-foreground/80">v{number}</span>
              <span suppressHydrationWarning> · {relativeTime(version.createdAt)}</span>
            </>
          ) : (
            "Not applied yet"
          )}
        </ItemDescription>
      </ItemContent>
      {version && onBookmark && (
        <ItemActions>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-pressed={version.bookmarked}
                  aria-label={version.bookmarked ? "Remove bookmark" : "Bookmark this version"}
                  onClick={() => onBookmark(!version.bookmarked)}
                />
              }
            >
              <Bookmark className={cn(version.bookmarked && "fill-current text-amber-500")} />
            </TooltipTrigger>
            <TooltipContent>{version.bookmarked ? "Bookmarked" : "Bookmark"}</TooltipContent>
          </Tooltip>
        </ItemActions>
      )}
      <ItemFooter className="justify-start">
        <Button size="xs" variant="outline" onClick={() => setDetails(true)}>
          <FileDiff data-icon="inline-start" />
          Details
        </Button>
        <Button size="xs" variant={previewing ? "secondary" : "outline"} onClick={onPreview}>
          <Eye data-icon="inline-start" />
          {previewing ? "Previewing" : "Preview"}
        </Button>
      </ItemFooter>
      <DetailsDialog open={details} onOpenChange={setDetails} title={title} loadDiff={loadDiff} />
    </Item>
  );
}
