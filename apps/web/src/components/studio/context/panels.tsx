"use client";

import { formatDistanceToNowStrict } from "date-fns";
import { Check, GitPullRequestArrow, X } from "lucide-react";
import { motion } from "motion/react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { canDecide, VIEWER_NOTE } from "@/lib/studio/context-model";
import { usd } from "@/lib/studio/model";
import type { ContextTurn, Member, Proposal } from "@/lib/studio/types";
import { cn } from "@/lib/utils";
import { StepLine } from "./dock";

const KIND: Record<Proposal["kind"], string> = { add: "Add", edit: "Change", remove: "Remove", answer: "Answer" };

/** Proposals: what viewers (and the agent on a viewer's turn) would change. An editor accepts or rejects. */
export function ProposalsMenu({
  proposals,
  me,
  open,
  onOpenChange,
  nameOf,
  onDecide,
}: {
  proposals: Proposal[];
  me: Member;
  open: boolean;
  onOpenChange(open: boolean): void;
  nameOf(user: string): string;
  onDecide(p: Proposal, decision: "accept" | "reject"): void;
}) {
  const waiting = proposals.filter((p) => p.status === "open");
  const decided = proposals.filter((p) => p.status !== "open").slice(-3).reverse();
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <Tooltip>
        <TooltipTrigger render={<PopoverTrigger render={<Button size="sm" variant={waiting.length ? "outline" : "ghost"} aria-label={`${waiting.length} proposals`} className={cn("gap-1.5", waiting.length > 0 && "border-amber-500/40")} />} />}>
          <GitPullRequestArrow />
          {waiting.length > 0 && <span className="rounded-full bg-amber-500 px-1.5 text-[11px] leading-4 font-semibold text-white tabular-nums">{waiting.length}</span>}
          <span className="hidden xl:inline">Proposals</span>
        </TooltipTrigger>
        <TooltipContent>{waiting.length ? "Changes waiting for an editor" : "No proposals"}</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-96 gap-0 p-0">
        <div className="border-b px-3 py-2 text-sm font-medium">Proposals</div>
        <div className="flex max-h-96 flex-col overflow-y-auto p-1.5">
          {waiting.length === 0 && decided.length === 0 && <p className="px-1.5 py-4 text-center text-sm text-muted-foreground">Nothing is proposed. A viewer&apos;s edits, answers and prompts show up here.</p>}
          {waiting.map((p) => (
            <div key={p.id} className="flex flex-col gap-2 rounded-lg p-2 transition-colors hover:bg-muted/50">
              <div className="text-sm leading-snug">{p.summary}</div>
              <div className="flex items-center gap-1.5">
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                  {KIND[p.kind]} · {p.by === me.user ? "you" : nameOf(p.by)} · {formatDistanceToNowStrict(new Date(p.at))} ago
                </span>
                {canDecide(me, p) ? (
                  <>
                    <Button size="xs" variant="ghost" onClick={() => onDecide(p, "reject")}>
                      <X data-icon="inline-start" />
                      Reject
                    </Button>
                    <Button size="xs" onClick={() => onDecide(p, "accept")}>
                      <Check data-icon="inline-start" />
                      Accept
                    </Button>
                  </>
                ) : (
                  <Tooltip>
                    <TooltipTrigger render={<span className="text-xs text-muted-foreground" />}>Waiting for an editor</TooltipTrigger>
                    <TooltipContent>{VIEWER_NOTE}</TooltipContent>
                  </Tooltip>
                )}
              </div>
            </div>
          ))}
          {decided.map((p) => (
            <div key={p.id} className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground">
              {p.status === "accepted" ? <Check className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" /> : <X className="size-3.5 shrink-0" />}
              <span className="min-w-0 flex-1 truncate">{p.summary}</span>
              <span className="shrink-0">
                {p.status} by {p.decidedBy === me.user ? "you" : nameOf(p.decidedBy ?? "")}
              </span>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

const TURN: Record<ContextTurn["kind"], string> = { prompt: "Asked", answers: "Answered", build: "Build", ask: "Asked the agent" };
const STATUS: Record<ContextTurn["status"], string> = { running: "Working", needs_you: "Waiting for answers", succeeded: "Done", cancelled: "Stopped", failed: "Failed" };

/**
 * Activity: the App's one thread, turn by turn, with the agent's steps and cost. Closed by default
 * and never where a newcomer lands; everything a person needs is in the Context itself.
 */
export function ActivityPanel({ turns, nameOf, onClose }: { turns: ContextTurn[]; nameOf(user: string): string; onClose(): void }) {
  const total = turns.reduce((n, t) => n + t.costUsd, 0);
  return (
    <motion.aside
      aria-label="Activity"
      initial={{ x: "100%" }}
      animate={{ x: 0 }}
      exit={{ x: "100%" }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      className="absolute inset-y-0 right-0 z-30 flex w-[min(420px,100%)] flex-col border-l bg-background shadow-xl"
    >
      <header className="flex h-11 shrink-0 items-center gap-2 border-b pr-1.5 pl-3">
        <span className="text-sm font-medium">Activity</span>
        <span className="text-xs text-muted-foreground tabular-nums">
          {turns.length} {turns.length === 1 ? "turn" : "turns"} · {usd(total)}
        </span>
        <Button size="icon-sm" variant="ghost" aria-label="Close activity" onClick={onClose} className="ml-auto">
          <X />
        </Button>
      </header>
      <ol className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-3">
        {turns.length === 0 && <li className="py-8 text-center text-sm text-muted-foreground">Nothing has happened yet.</li>}
        {[...turns].reverse().map((t) => (
          <li key={t.id} className="flex flex-col gap-1.5">
            <div className="flex items-baseline gap-2 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{nameOf(t.by)}</span>
              <span>{TURN[t.kind]}</span>
              <span className="ml-auto shrink-0 tabular-nums">
                {STATUS[t.status]} · {formatDistanceToNowStrict(new Date(t.startedAt))} ago · {usd(t.costUsd)}
              </span>
            </div>
            <p className="text-sm leading-snug">{t.prompt}</p>
            {t.activity.length > 0 && (
              <ul className="rounded-lg border bg-muted/30 px-2.5 py-2">
                {t.activity.map((s, i) => (
                  <StepLine key={i} step={s} />
                ))}
              </ul>
            )}
            {t.reply && <p className={cn("text-sm leading-snug text-muted-foreground", t.status === "failed" && "text-destructive")}>{t.reply}</p>}
          </li>
        ))}
      </ol>
    </motion.aside>
  );
}
