"use client";

import { CircleCheck, CircleDashed, Hammer, History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { VIEWER_NOTE, type Freshness } from "@/lib/studio/context-model";
import { cn } from "@/lib/utils";
import { FragmentGlyph } from "./fragment-meta";

/**
 * Whether the prototype reflects the Context: "Up to date with the Context", or "2 changes behind"
 * with the fragments that changed and Update. Sits under the prototype's frame.
 */
export function FreshnessBar({ fresh, building, canEdit, onUpdate, onGo }: { fresh: Freshness; building: boolean; canEdit: boolean; onUpdate(): void; onGo(fragmentId: string): void }) {
  if (fresh.kind === "never") return null;
  const behind = fresh.kind === "behind";
  return (
    <div role="status" className={cn("flex h-10 shrink-0 items-center gap-2 border-t bg-background px-3 text-sm", behind && "bg-amber-500/5")}>
      {building ? (
        <>
          <Hammer className="size-4 shrink-0 text-violet-600 dark:text-violet-400" />
          <span className="shimmer">Updating the prototype</span>
        </>
      ) : !behind ? (
        <>
          <CircleCheck className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <span className="text-muted-foreground">Up to date with the Context</span>
        </>
      ) : (
        <>
          <CircleDashed className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <Popover>
            <PopoverTrigger render={<button type="button" className="min-w-0 truncate rounded-sm font-medium underline-offset-2 hover:underline" />}>
              {fresh.count} {fresh.count === 1 ? "change" : "changes"} behind the Context
            </PopoverTrigger>
            <PopoverContent align="start" side="top" className="w-80 gap-1 p-1.5">
              <div className="flex items-center gap-1.5 px-1.5 py-1 text-xs font-medium text-muted-foreground">
                <History className="size-3.5" />
                Changed since the last build
              </div>
              {fresh.fragments.length === 0 && <div className="px-1.5 py-1 text-sm text-muted-foreground">The Context changed.</div>}
              {fresh.fragments.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  disabled={f.change === "removed"}
                  onClick={() => onGo(f.id)}
                  className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-sm transition-colors hover:bg-muted disabled:opacity-60 disabled:hover:bg-transparent"
                >
                  <FragmentGlyph type={f.type} className="size-3.5 shrink-0" />
                  <span className={cn("min-w-0 flex-1 truncate", f.change === "removed" && "line-through")}>{f.title}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{f.change}</span>
                </button>
              ))}
            </PopoverContent>
          </Popover>
          <Tooltip>
            <TooltipTrigger render={<Button size="sm" aria-disabled={!canEdit} onClick={canEdit ? onUpdate : undefined} className={cn("ml-auto", !canEdit && "cursor-not-allowed opacity-50")} />}>Update</TooltipTrigger>
            <TooltipContent>{canEdit ? "Build from the Context as it is now" : VIEWER_NOTE}</TooltipContent>
          </Tooltip>
        </>
      )}
    </div>
  );
}
