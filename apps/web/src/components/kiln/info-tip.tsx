"use client";

import { CircleQuestionMark } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** The "?" circle next to card titles and form labels: bold title line plus a description on hover or focus. */
export function InfoTip({ title, children, className }: { title?: string; children: React.ReactNode; className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={<button type="button" aria-label={title ? `About ${title}` : "More info"} className={cn("inline-flex size-4 items-center justify-center rounded-full text-muted-foreground/80 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring", className)} />}
      >
        <CircleQuestionMark className="size-3.5" />
      </TooltipTrigger>
      <TooltipContent className="block max-w-72 px-3 py-2 text-left leading-relaxed">
        {title && <div className="mb-0.5 font-semibold">{title}</div>}
        <div>{children}</div>
      </TooltipContent>
    </Tooltip>
  );
}
