"use client";

import { Circle, CircleCheck, CircleDot, CircleX, ExternalLink, GitPullRequest, Rocket, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Trace, TraceIcon, TraceLine, TraceTitle } from "@/components/ui/trace";
import { prSteps, PULL_REQUEST_LABEL } from "@/lib/studio/model";
import type { AppPullRequest, PullRequestState } from "@/lib/studio/types";
import { cn } from "@/lib/utils";
import { Confirm } from "./confirm";

const TONE: Record<PullRequestState, string> = {
  uat: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  ready_for_review: "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300",
  waiting_for_review: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  merged: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  cancelled: "border-border bg-muted text-muted-foreground",
};

const STEP_ICON = {
  done: <CircleCheck className="text-emerald-600 dark:text-emerald-400" />,
  current: <CircleDot className="text-violet-600 dark:text-violet-400" />,
  waiting: <CircleDot className="text-amber-600 dark:text-amber-400" />,
  cancelled: <CircleX className="text-muted-foreground" />,
  todo: <Circle className="text-muted-foreground/50" />,
} as const;

function LinkRow({ href, label }: { href?: string; label: string }) {
  if (!href) return null;
  return (
    <a href={href} target="_blank" rel="noreferrer" className="flex h-8 items-center gap-2 rounded-md px-2 text-sm hover:bg-muted">
      <ExternalLink className="size-3.5 text-muted-foreground" />
      {label}
    </a>
  );
}

/**
 * The App's pull request in the header: Ship when there is none open, else its state badge. The
 * badge opens every step (UAT → Ready for review → Merged or Waiting for review), the merge gate's
 * reasons, the previews, and the author's actions.
 */
export function ShipControl({
  pullRequest,
  onShip,
}: {
  pullRequest?: AppPullRequest;
  onShip: (state?: "uat" | "ready_for_review" | "cancelled") => Promise<AppPullRequest>;
}) {
  const live = pullRequest && pullRequest.state !== "merged" && pullRequest.state !== "cancelled" ? pullRequest : undefined;
  const run = async (state?: "uat" | "ready_for_review" | "cancelled") => {
    try {
      const pr = await onShip(state);
      if (!state) toast.success(`Pull request #${pr.number} is in UAT`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <div className="flex items-center gap-1.5">
      {pullRequest && (
        <Popover>
          <PopoverTrigger
            render={
              <button type="button" className={cn("flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium", TONE[pullRequest.state])} />
            }
          >
            <GitPullRequest className="size-3.5" />
            {PULL_REQUEST_LABEL[pullRequest.state]}
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80 gap-3 p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <a href={pullRequest.url} target="_blank" rel="noreferrer" className="text-sm font-medium hover:underline">
                  Pull request #{pullRequest.number}
                </a>
                <div className="truncate font-mono text-xs text-muted-foreground">
                  {pullRequest.branch} → {pullRequest.base}
                </div>
              </div>
              <span className={cn("shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium", TONE[pullRequest.state])}>
                {PULL_REQUEST_LABEL[pullRequest.state]}
              </span>
            </div>
            <Trace className="gap-1">
              {prSteps(pullRequest.state).map((s) => (
                <TraceLine
                  key={s.label}
                  status={s.status === "todo" ? "pending" : undefined}
                  className={cn("h-7", (s.status === "current" || s.status === "waiting") && "font-medium text-foreground")}
                >
                  <TraceIcon>{STEP_ICON[s.status]}</TraceIcon>
                  <TraceTitle>{s.label}</TraceTitle>
                </TraceLine>
              ))}
            </Trace>
            {pullRequest.state === "waiting_for_review" && pullRequest.reasons?.length ? (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-2.5">
                <div className="mb-1 text-xs font-medium text-amber-700 dark:text-amber-300">Merge gate</div>
                <ul className="list-disc space-y-0.5 pl-4 text-sm">
                  {pullRequest.reasons.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div className="-mx-1 flex flex-col">
              <LinkRow href={pullRequest.builtInPreview} label="Built-in preview" />
              <LinkRow href={pullRequest.previewUrl} label="Deployment preview" />
              <LinkRow href={pullRequest.url} label={`${pullRequest.repo}#${pullRequest.number}`} />
            </div>
            {live && (
              <div className="flex justify-end gap-2 border-t pt-3">
                <Confirm
                  trigger={
                    <Button size="sm" variant="ghost">
                      <X data-icon="inline-start" />
                      Cancel
                    </Button>
                  }
                  icon={<X />}
                  title={`Cancel pull request #${live.number}?`}
                  description="Closes the pull request on the forge. The App and its versions stay."
                  action="Cancel pull request"
                  onConfirm={() => run("cancelled")}
                />
                {live.state === "uat" && (
                  <Confirm
                    trigger={<Button size="sm">Ready for review</Button>}
                    icon={<GitPullRequest />}
                    title="Ready for review?"
                    description="The merge gate checks the pull request. It merges it, or sends it to a reviewer with its reasons."
                    action="Ready for review"
                    onConfirm={() => run("ready_for_review")}
                  />
                )}
              </div>
            )}
          </PopoverContent>
        </Popover>
      )}
      {!live && (
        <Confirm
          trigger={
            <Button size="sm">
              <Rocket data-icon="inline-start" />
              Ship
            </Button>
          }
          icon={<Rocket />}
          title="Ship this App?"
          description="Pushes the latest version and opens a pull request in UAT."
          action="Ship"
          onConfirm={() => run()}
        />
      )}
    </div>
  );
}
