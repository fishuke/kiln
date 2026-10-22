"use client";

import {
  AlertCircle,
  Bot,
  Brain,
  Eye,
  FilePen,
  FileText,
  GitMerge,
  Hammer,
  ListChecks,
  MessageCircleQuestion,
  MessageSquare,
  Mic,
  Search,
  Terminal,
  Undo2,
  Wrench,
} from "lucide-react";
import { Markdown } from "@/components/kiln/markdown";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Button } from "@/components/ui/button";
import { Item, ItemContent, ItemDescription, ItemFooter, ItemMedia, ItemTitle } from "@/components/ui/item";
import { Message, MessageContent, MessageFooter } from "@/components/ui/message";
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@/components/ui/trace";
import { relativeTime } from "@/lib/run-tree";
import { turnCard, workTitle } from "@/lib/studio/model";
import type { Activity, Turn } from "@/lib/studio/types";
import { cn } from "@/lib/utils";

const MD = "text-sm leading-6 [&_a]:text-violet-600 dark:[&_a]:text-violet-400";

/** The person's prompt: a muted bubble on the right, with its mode when it isn't Build. */
export function PromptBubble({ turn }: { turn: Turn }) {
  return (
    <Message align="end">
      <MessageContent className="gap-1">
        <Bubble align="end" variant="muted">
          <BubbleContent className="whitespace-pre-wrap">{turn.resolve ? "Resolve the merge conflict with main." : turn.prompt}</BubbleContent>
        </Bubble>
        <MessageFooter className="gap-1.5 px-0 font-normal">
          {turn.mode !== "build" && <span className="rounded-sm bg-muted px-1.5 py-px text-[11px] font-medium capitalize">{turn.mode}</span>}
          {turn.via === "voice" && <Mic className="size-3" aria-label="Spoken" />}
          {turn.resolve && <span>Started by Studio</span>}
          <span suppressHydrationWarning>{relativeTime(turn.startedAt)}</span>
        </MessageFooter>
      </MessageContent>
    </Message>
  );
}

const TOOL_ICON: Record<string, React.ReactNode> = {
  Bash: <Terminal />,
  Read: <FileText />,
  Edit: <FilePen />,
  Write: <FilePen />,
  MultiEdit: <FilePen />,
  Grep: <Search />,
  Glob: <Search />,
};

const TOOL_VERB: Record<string, string> = {
  Read: "Read",
  Edit: "Edited",
  Write: "Wrote",
  MultiEdit: "Edited",
  Grep: "Searched",
  Glob: "Searched",
  Bash: "Ran",
};

/** One activity line: Reasoning, Terminal, Tool, Subagent or an interim message. */
function ActivityLine({ a, live }: { a: Activity; live: boolean }) {
  if (a.kind === "reasoning")
    return (
      <TraceCollapsible>
        <TraceCollapsibleTrigger>
          <TraceLine status={live ? "running" : undefined}>
            <TraceIcon>
              <Brain />
            </TraceIcon>
            <TraceTitle>{live ? "Thinking" : "Thought"}</TraceTitle>
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent className="text-xs leading-5 whitespace-pre-wrap italic">{a.text}</TraceCollapsibleContent>
      </TraceCollapsible>
    );
  if (a.kind === "subagent")
    return (
      <TraceCollapsible defaultOpen={live}>
        <TraceCollapsibleTrigger>
          <TraceLine status={live ? "running" : undefined}>
            <TraceIcon>
              <Bot className="text-violet-600 dark:text-violet-400" />
            </TraceIcon>
            <TraceTitle>
              Subagent <span className="font-medium text-foreground">{a.name}</span>
            </TraceTitle>
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent className="border-violet-500/40 text-xs leading-5">{a.text}</TraceCollapsibleContent>
      </TraceCollapsible>
    );
  if (a.kind === "error")
    return (
      <TraceLine status="error">
        <TraceIcon>
          <AlertCircle />
        </TraceIcon>
        <TraceTitle>{a.text}</TraceTitle>
      </TraceLine>
    );
  if (a.kind === "report") return null;
  if (a.kind === "message")
    return (
      <TraceLine status={live ? "running" : undefined}>
        <TraceIcon>
          <MessageSquare />
        </TraceIcon>
        <TraceTitle>{a.text}</TraceTitle>
      </TraceLine>
    );
  return (
    <TraceLine status={live ? "running" : undefined}>
      <TraceIcon>{TOOL_ICON[a.name] ?? <Wrench />}</TraceIcon>
      <TraceTitle>
        {TOOL_VERB[a.name] ?? a.name}
        {a.text && <span className={cn("ml-1.5 text-foreground/80", a.name === "Bash" ? "font-mono text-[12px]" : "")}>{a.text}</span>}
      </TraceTitle>
    </TraceLine>
  );
}

/** The agent's work as a Chain of Thought: one collapsible line, open and shimmering while it runs. */
export function ActivityTrace({ turn }: { turn: Turn }) {
  const live = turn.status === "running";
  const steps = turn.activity.filter((a) => a.kind !== "report");
  if (!steps.length && !live) return null;
  const tools = steps.filter((a) => a.kind === "tool").length;
  return (
    <Trace>
      <TraceCollapsible defaultOpen={live} key={live ? "live" : "done"}>
        <TraceCollapsibleTrigger>
          <TraceLine status={live ? "running" : undefined}>
            <TraceIcon>
              <Hammer />
            </TraceIcon>
            <TraceTitle>{workTitle(turn)}</TraceTitle>
            {!live && tools > 0 && <TraceDescription className="text-xs">{tools} {tools === 1 ? "step" : "steps"}</TraceDescription>}
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent>
          <Trace>
            {steps.map((a, i) => (
              <ActivityLine key={i} a={a} live={live && i === steps.length - 1} />
            ))}
            {live && !steps.length && (
              <TraceLine status="running">
                <TraceTitle>Starting the agent</TraceTitle>
              </TraceLine>
            )}
          </Trace>
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  );
}

/** The Plan pattern for plan mode: the plan, with **Build it** here or in a new chat. */
export function PlanCard({
  plan,
  onBuild,
  onBuildInNewChat,
  disabled,
}: {
  plan: string;
  onBuild: () => void;
  onBuildInNewChat: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-xs">
      <div className="flex items-center gap-2 text-sm font-medium">
        <ListChecks className="size-4 text-violet-600 dark:text-violet-400" />
        Plan
      </div>
      <Markdown className={cn(MD, "[&_h2]:mt-0 [&_h2]:text-sm [&_h2]:font-semibold [&_ol]:my-1")}>{plan}</Markdown>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={onBuild} disabled={disabled}>
          <Hammer data-icon="inline-start" />
          Build it
        </Button>
        <Button size="sm" variant="ghost" onClick={onBuildInNewChat} disabled={disabled}>
          Build in a new chat
        </Button>
      </div>
    </div>
  );
}

/** The agent asked something: no card, just the question, marked as waiting on you. */
export function QuestionNote({ question }: { question: string }) {
  return (
    <Item variant="muted" size="sm" className="border-amber-500/30 bg-amber-500/10">
      <ItemMedia variant="icon">
        <MessageCircleQuestion className="text-amber-600 dark:text-amber-400" />
      </ItemMedia>
      <ItemContent>
        <ItemTitle className="text-xs font-medium tracking-wide text-amber-700 uppercase dark:text-amber-400">Needs you</ItemTitle>
        <ItemDescription className="line-clamp-none text-foreground">{question}</ItemDescription>
      </ItemContent>
    </Item>
  );
}

/** A chat stopped on a merge conflict: the files, and what happens next. */
export function ConflictNote({ files, onPreview }: { files: string; onPreview?: () => void }) {
  return (
    <Item variant="outline" size="sm" className="border-destructive/30">
      <ItemMedia variant="icon">
        <GitMerge className="text-destructive" />
      </ItemMedia>
      <ItemContent>
        <ItemTitle>This chat conflicts with main</ItemTitle>
        <ItemDescription className="line-clamp-none">{files}</ItemDescription>
      </ItemContent>
      {onPreview && (
        <ItemFooter>
          <Button size="xs" variant="outline" onClick={onPreview}>
            <Eye data-icon="inline-start" />
            Preview this chat
          </Button>
        </ItemFooter>
      )}
    </Item>
  );
}

/**
 * One turn: the prompt, the agent's work, its reply, and how it ended. `versionCard` renders the
 * Checkpoint for a turn that changed files; a question, a plan or an answer makes no version card.
 */
export function TurnView({
  turn,
  versionCard,
  onBuildPlan,
  busy,
  renderReport,
}: {
  turn: Turn;
  versionCard: React.ReactNode;
  onBuildPlan: (plan: string, newChat: boolean) => void;
  busy: boolean;
  /** A child chat's report in this lead's thread. */
  renderReport?: (report: Extract<Activity, { kind: "report" }>) => React.ReactNode;
}) {
  const card = turnCard(turn);
  return (
    <div className="flex flex-col gap-4">
      <PromptBubble turn={turn} />
      <Message>
        <MessageContent className="gap-3">
          <ActivityTrace turn={turn} />
          {renderReport &&
            turn.activity.map((a, i) => (a.kind === "report" ? <div key={i}>{renderReport(a)}</div> : null))}
          {turn.reply && <Markdown className={MD}>{turn.reply}</Markdown>}
          {card === "question" && <QuestionNote question={turn.question!} />}
          {card === "plan" && (
            <PlanCard plan={turn.plan!} disabled={busy} onBuild={() => onBuildPlan(turn.plan!, false)} onBuildInNewChat={() => onBuildPlan(turn.plan!, true)} />
          )}
          {card === "version" && versionCard}
          {card === "discarded" && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Undo2 className="size-3.5" />
              Changes discarded in {turn.mode === "plan" ? "Plan" : "Chat"} mode
            </div>
          )}
          {card === "failed" && (
            <div className="flex items-center gap-2 text-xs text-destructive">
              <AlertCircle className="size-3.5" />
              This turn failed
              {turn.activity.findLast((a) => a.kind === "error") ? `: ${(turn.activity.findLast((a) => a.kind === "error") as { text: string }).text}` : "."}
            </div>
          )}
        </MessageContent>
      </Message>
    </div>
  );
}
