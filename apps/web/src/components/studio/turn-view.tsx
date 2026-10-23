"use client";

import { useState } from "react";
import { toast } from "sonner";
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
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  Terminal,
  Undo2,
  Wrench,
} from "lucide-react";
import { Markdown } from "@/components/kiln/markdown";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Button } from "@/components/ui/button";
import { Item, ItemActions, ItemContent, ItemDescription, ItemFooter, ItemMedia, ItemTitle } from "@/components/ui/item";
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
import { turnCard, traceSteps, workTitle } from "@/lib/studio/model";
import type { Activity, CommandApproval, Turn } from "@/lib/studio/types";
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
          {turn.traceId && <TraceId id={turn.traceId} />}
        </MessageFooter>
      </MessageContent>
    </Message>
  );
}

/** The turn's trace id, muted: enough to find it in the tracing backend from a screenshot; click copies it. */
function TraceId({ id }: { id: string }) {
  return (
    <button
      type="button"
      title={`Trace ${id}`}
      className="font-mono text-[11px] text-muted-foreground/60 hover:text-muted-foreground"
      onClick={() => {
        void navigator.clipboard.writeText(id).then(() => toast.success("Trace id copied"));
      }}
    >
      trace {id.slice(0, 8)}
    </button>
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
      <TraceCollapsible>
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
  const steps = traceSteps(turn);
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

/**
 * The Confirmation pattern for a command the turn's run waits on: the command, **Block** or **Allow**.
 * Once decided, one line says what happened.
 */
export function CommandApprovalCard({
  approval,
  onDecide,
}: {
  approval: CommandApproval;
  onDecide: (decision: "approve" | "reject") => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  if (approval.state !== "waiting") {
    const allowed = approval.state === "allowed";
    return (
      <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
        {allowed ? <ShieldCheck className="size-3.5 shrink-0" /> : <ShieldX className="size-3.5 shrink-0 text-destructive" />}
        <span className="shrink-0">
          {allowed ? "Allowed" : "Blocked"}
          {approval.by ? ` by ${approval.by}` : allowed ? "" : " without an answer"}
        </span>
        <code className="truncate font-mono text-[11px]">{approval.command}</code>
      </div>
    );
  }
  const decide = async (decision: "approve" | "reject") => {
    setBusy(true);
    try {
      await onDecide(decision);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Item variant="outline" size="sm" className="items-start border-amber-500/40">
      <ItemMedia variant="icon">
        <ShieldAlert className="text-amber-600 dark:text-amber-400" />
      </ItemMedia>
      <ItemContent className="min-w-0">
        <ItemTitle>Allow this command?</ItemTitle>
        <pre className="max-h-40 overflow-auto rounded-md bg-muted px-2 py-1.5 font-mono text-xs break-all whitespace-pre-wrap">{approval.command}</pre>
        <ItemDescription className="line-clamp-none">The agent waits for you. Without an answer, the command is blocked.</ItemDescription>
      </ItemContent>
      <ItemActions className="basis-full justify-end pt-1">
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void decide("reject")}>
          Block
        </Button>
        <Button size="sm" disabled={busy} onClick={() => void decide("approve")}>
          Allow
        </Button>
      </ItemActions>
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
  onDecideApproval,
  busy,
}: {
  turn: Turn;
  versionCard: React.ReactNode;
  onBuildPlan: (plan: string, newChat: boolean) => void;
  onDecideApproval: (gateId: string, decision: "approve" | "reject") => Promise<void>;
  busy: boolean;
}) {
  const card = turnCard(turn);
  return (
    <div className="flex flex-col gap-4">
      <PromptBubble turn={turn} />
      <Message>
        <MessageContent className="gap-3">
          <ActivityTrace turn={turn} />
          {turn.approval && (turn.approval.state !== "waiting" || turn.status === "running") && (
            <CommandApprovalCard approval={turn.approval} onDecide={(decision) => onDecideApproval(turn.approval!.gateId, decision)} />
          )}
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
