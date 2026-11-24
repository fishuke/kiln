"use client";

import { ArrowDownToLine, ChevronDown, CircleAlert, CircleQuestionMark, Hammer, LoaderCircle, RotateCw, Square } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { activityLine, VIEWER_NOTE, type Freshness } from "@/lib/studio/context-model";
import type { Activity, AgentStatus, ContextTurn } from "@/lib/studio/types";
import { cn } from "@/lib/utils";

/** One step of a turn, as the opened activity line lists it: the only place tool names show. */
export function StepLine({ step }: { step: Activity }) {
  return (
    <li className="flex gap-2 text-xs leading-5">
      <span className="w-24 shrink-0 truncate font-mono text-muted-foreground">{step.kind === "tool" || step.kind === "subagent" ? step.name : step.kind === "reasoning" ? "thinking" : step.kind}</span>
      <span className={cn("min-w-0 flex-1", step.kind === "error" ? "text-destructive" : "text-foreground/80")}>{"text" in step ? step.text : ""}</span>
    </li>
  );
}

/**
 * The dock's rows above the composer: the activity line (one row: a state and its object, with
 * Stop; opening it lists this turn's steps) and what waits for the person.
 */
export function DockStatus({
  agent,
  turn,
  openQuestions,
  fresh,
  canEdit,
  hasContext,
  away,
  failure,
  onRetry,
  onJump,
  onStop,
  onQuestions,
  onContinue,
  onBuild,
}: {
  agent: AgentStatus;
  /** The turn the agent is on, for its steps. */
  turn?: ContextTurn;
  openQuestions: number;
  fresh: Freshness;
  canEdit: boolean;
  /** False while the Context has nothing to build from. */
  hasContext: boolean;
  away: boolean;
  /** Why the last turn ended without doing its work, when it did. Never left unsaid. */
  failure?: { text: string; stopped: boolean };
  onRetry(): void;
  onJump(): void;
  onStop(): void;
  onQuestions(): void;
  onContinue(): void;
  onBuild(): void;
}) {
  const [open, setOpen] = useState(false);
  const line = activityLine(agent, openQuestions);
  const busy = Boolean(line?.busy);
  const steps = turn?.activity ?? [];
  const canBuild = !busy && hasContext && openQuestions === 0 && fresh.kind !== "fresh";
  if (!line && !openQuestions && !canBuild && !failure) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <AnimatePresence initial={false}>
        {line && (
          <motion.div key="line" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 4 }} transition={{ duration: 0.15, ease: "easeOut" }} className="overflow-hidden rounded-lg border bg-card text-sm shadow-xs">
            <div className="flex h-9 items-center gap-2 pr-1 pl-2.5" role="status" aria-live="polite">
              {busy ? <LoaderCircle className="size-3.5 shrink-0 animate-spin text-violet-600 dark:text-violet-400" /> : <span className="size-1.5 shrink-0 rounded-full bg-amber-500" />}
              <span className={cn("min-w-0 flex-1 truncate", busy && "shimmer")}>{line.text}</span>
              {line.progress !== undefined && (
                <span className="h-1 w-16 shrink-0 overflow-hidden rounded-full bg-muted" aria-hidden>
                  <span className="block h-full origin-left rounded-full bg-violet-500 transition-transform duration-200 ease-out" style={{ transform: `scaleX(${line.progress})` }} />
                </span>
              )}
              {away && (
                <Button size="xs" variant="outline" onClick={onJump} className="shrink-0">
                  <ArrowDownToLine data-icon="inline-start" />
                  <span className="hidden sm:inline">Jump to where the agent is writing</span>
                  <span className="sm:hidden">Jump</span>
                </Button>
              )}
              {steps.length > 0 && (
                <Tooltip>
                  <TooltipTrigger render={<Button size="icon-xs" variant="ghost" aria-label="This turn's steps" aria-expanded={open} onClick={() => setOpen((o) => !o)} />}>
                    <ChevronDown className={cn("transition-transform duration-150", open && "rotate-180")} />
                  </TooltipTrigger>
                  <TooltipContent>{open ? "Hide the steps" : "Show this turn's steps"}</TooltipContent>
                </Tooltip>
              )}
              {busy && (
                <Button size="xs" variant="ghost" onClick={onStop} className="shrink-0">
                  <Square data-icon="inline-start" className="fill-current" />
                  Stop
                </Button>
              )}
            </div>
            {open && steps.length > 0 && (
              <ul className="max-h-40 overflow-y-auto border-t px-2.5 py-2">
                {steps.map((s, i) => (
                  <StepLine key={i} step={s} />
                ))}
              </ul>
            )}
          </motion.div>
        )}
      </AnimatePresence>
      {failure && !busy && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 py-2 pr-1.5 pl-2.5 text-sm">
          <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
          <span className="min-w-0 flex-1">
            <span className="font-medium">{failure.stopped ? "The agent was stopped." : "The agent couldn't do that."}</span> <span className="break-words text-muted-foreground">{failure.text}</span>
          </span>
          <Button size="xs" variant="outline" onClick={onRetry} className="shrink-0">
            <RotateCw data-icon="inline-start" />
            Try again
          </Button>
        </div>
      )}
      {(openQuestions > 0 || canBuild) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {openQuestions > 0 && (
            <Tooltip>
              <TooltipTrigger render={<Button size="sm" variant="outline" onClick={onQuestions} className="border-orange-500/40" />}>
                <CircleQuestionMark data-icon="inline-start" className="text-orange-600 dark:text-orange-400" />
                {openQuestions} {openQuestions === 1 ? "question" : "questions"} waiting
              </TooltipTrigger>
              <TooltipContent>
                Go to the next one. <Kbd>1</Kbd>–<Kbd>4</Kbd> pick, <Kbd>↵</Kbd> confirms
              </TooltipContent>
            </Tooltip>
          )}
          {openQuestions > 0 && !busy && (
            <Tooltip>
              <TooltipTrigger render={<Button size="sm" variant="ghost" aria-disabled={!canEdit} onClick={canEdit ? onContinue : undefined} className={cn(!canEdit && "cursor-not-allowed opacity-50")} />}>Continue</TooltipTrigger>
              <TooltipContent>{canEdit ? "Go on with what is answered. The agent assumes the rest" : VIEWER_NOTE}</TooltipContent>
            </Tooltip>
          )}
          {canBuild && (
            <Tooltip>
              <TooltipTrigger render={<Button size="sm" aria-disabled={!canEdit} onClick={canEdit ? onBuild : undefined} className={cn("ml-auto", !canEdit && "cursor-not-allowed opacity-50")} />}>
                <Hammer data-icon="inline-start" />
                {fresh.kind === "never" ? "Build prototype" : "Update prototype"}
              </TooltipTrigger>
              <TooltipContent>{canEdit ? "Build from the Context as it is now" : VIEWER_NOTE}</TooltipContent>
            </Tooltip>
          )}
        </div>
      )}
    </div>
  );
}
