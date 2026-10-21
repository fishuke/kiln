"use client";

import { useRouter } from "next/navigation";
import { ArrowUpRight, CircleSlash, Hash, Link2, SquareArrowOutUpRight } from "lucide-react";
import { toast } from "sonner";
import { GitHubIcon } from "@/components/kiln/brand-icons";
import { StatusSquare } from "@/components/kiln/run-visuals";
import { ContextMenu, ContextMenuContent, ContextMenuGroup, ContextMenuItem, ContextMenuLabel, ContextMenuSeparator, ContextMenuTrigger } from "@/components/ui/context-menu";
import { canCancel, type RunRow } from "@/lib/run-tree";
import { cn } from "@/lib/utils";

const ITEM = "h-8 gap-2.5 px-2 [&_svg:not([class*='text-'])]:text-muted-foreground";

function copy(text: string, what: string) {
  void navigator.clipboard?.writeText(text).then(
    () => toast.success(`${what} copied`),
    () => toast.error("Could not copy"),
  );
}

/** Right-click menu for a run row: open, copy, and cancel. */
export function RunContextMenu({ row, href, className, style, onCancel, children }: { row: RunRow; href: string; className?: string; style?: React.CSSProperties; onCancel: (row: RunRow) => void; children: React.ReactNode }) {
  const router = useRouter();
  const absolute = () => new URL(href, window.location.origin).toString();
  return (
    <ContextMenu>
      <ContextMenuTrigger className={cn("select-auto", className)} style={style}>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-60 rounded-xl p-1.5 shadow-xl ring-foreground/[0.08]">
        <ContextMenuGroup>
          <ContextMenuLabel className="flex items-center gap-2 px-2 pt-1 pb-1.5">
            <StatusSquare status={row.status} className="size-3.5 shrink-0" />
            <span className="truncate text-xs font-medium text-muted-foreground">{row.title}</span>
          </ContextMenuLabel>
        </ContextMenuGroup>
        <ContextMenuSeparator />
        <ContextMenuItem className={ITEM} onClick={() => router.push(href)}>
          <ArrowUpRight />
          Open
        </ContextMenuItem>
        <ContextMenuItem className={ITEM} onClick={() => window.open(href, "_blank", "noopener")}>
          <SquareArrowOutUpRight />
          Open in new tab
        </ContextMenuItem>
        {row.prUrl && (
          <ContextMenuItem className={ITEM} onClick={() => window.open(row.prUrl, "_blank", "noopener")}>
            <GitHubIcon className="size-4" />
            Open pull request
          </ContextMenuItem>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem className={ITEM} onClick={() => copy(absolute(), "Link")}>
          <Link2 />
          Copy link
        </ContextMenuItem>
        <ContextMenuItem className={ITEM} onClick={() => copy(row.id, "Run ID")}>
          <Hash />
          Copy ID
          <span className="ml-auto max-w-20 truncate font-mono text-[11px] text-muted-foreground/70">{row.id}</span>
        </ContextMenuItem>
        {canCancel(row) && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem variant="destructive" className={ITEM} onClick={() => onCancel(row)}>
              <CircleSlash />
              Cancel run
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
