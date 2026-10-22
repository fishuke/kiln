"use client";

import Link from "next/link";
import { AlertCircle, Bot, Brain, Check, Circle, CircleAlert, CircleCheck, CircleDot, CircleX, GitBranch, ListChecks, LoaderCircle, Terminal, Wrench } from "lucide-react";
import { Fragment } from "react";
import { SentAttachments } from "@/components/kiln/attachments";
import { GateCard } from "@/components/kiln/gate-card";
import { Markdown } from "@/components/kiln/markdown";
import { PersonAvatar, StatusSquare, personName } from "@/components/kiln/run-visuals";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { CodeBlock, CodeBlockContent, CodeBlockHeader, CodeBlockTitle } from "@/components/ui/code-block";
import { Message, MessageContent, MessageFooter } from "@/components/ui/message";
import { MessageScrollerItem } from "@/components/ui/message-scroller";
import { Trace, TraceCollapsible, TraceCollapsibleContent, TraceCollapsibleTrigger, TraceDescription, TraceIcon, TraceLine, TraceTitle } from "@/components/ui/trace";
import type { Step, TranscriptItem } from "@/lib/run-detail";
import type { PlanView, TaskLineStatus } from "@/lib/run-plan";
import { relativeTime } from "@/lib/run-tree";
import { reasoningTitle, stepStatus, subagentsTitle, workSummary, workTitle } from "@/lib/trace-lines";
import { cn } from "@/lib/utils";

/**
 * `live`: the agent is still working, so its latest steps start open.
 * `scroller`: wrap each item for the Message Scroller; the person's turns are the scroll anchors.
 */
export function Transcript({
  items,
  showThinking,
  showTools,
  prUrl,
  previewUrl,
  live,
  scroller,
}: {
  items: TranscriptItem[];
  showThinking: boolean;
  showTools: boolean;
  prUrl?: string;
  previewUrl?: string;
  live?: boolean;
  scroller?: boolean;
}) {
  const rendered = items.map((it, i) => {
    const node = renderItem(it, i);
    if (!node) return null;
    return scroller ? (
      <MessageScrollerItem key={it.key} messageId={it.key} scrollAnchor={it.type === "user"}>
        {node}
      </MessageScrollerItem>
    ) : (
      <Fragment key={it.key}>{node}</Fragment>
    );
  });
  return scroller ? <>{rendered}</> : <div className="flex flex-col gap-5">{rendered}</div>;

  function renderItem(it: TranscriptItem, i: number): React.ReactNode {
    if (it.type === "user") return <UserMessage item={it} />;
    if (it.type === "agent")
      return (
        <Message>
          <MessageContent className="gap-1">
            <Markdown className="text-sm leading-6 [&_a]:text-violet-600 dark:[&_a]:text-violet-400">{it.text}</Markdown>
            <span className="text-xs text-muted-foreground" suppressHydrationWarning>
              {relativeTime(it.at)}
            </span>
          </MessageContent>
        </Message>
      );
    if (it.type === "reasoning")
      return showThinking ? (
        <Trace>
          <Reasoning text={it.text} durationMs={it.durationMs} />
        </Trace>
      ) : null;
    if (it.type === "work")
      return showTools ? <WorkGroup durationMs={it.durationMs} steps={it.steps.filter((s) => showThinking || s.kind !== "reasoning")} working={live && i === items.length - 1} /> : null;
    if (it.type === "subagents") return <Subagents item={it} showThinking={showThinking} showTools={showTools} />;
    if (it.type === "tasks") return <Plan plan={it.plan} />;
    if (it.type === "waiting")
      return (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-blue-500" />
          <span>{it.text}</span>
        </div>
      );
    if (it.type === "gate") {
      // The foreman usually posts the same text it asks about; show it once.
      const head = it.gate.question?.slice(0, 80);
      const said = Boolean(head && items.some((x) => x.type === "agent" && x.text.includes(head)));
      return <GateCard gate={it.gate} prUrl={prUrl} previewUrl={previewUrl} hideQuestion={said && it.gate.kind !== "question"} />;
    }
    if (it.type === "system" && /^Completed .+ \(\d+\/\d+\)$/.test(it.text))
      return (
        <div className="flex items-center gap-2 border-b pb-3 text-xs text-muted-foreground">
          <Check className="size-3.5 shrink-0" />
          <span>{it.text}</span>
        </div>
      );
    return (
      <div className={cn("flex items-start gap-2 text-xs text-muted-foreground", it.tone === "error" && "text-red-600 dark:text-red-400")}>
        {it.tone === "error" ? <CircleAlert className="mt-px size-3.5 shrink-0" /> : <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-muted-foreground/50" />}
        <span>{it.text}</span>
      </div>
    );
  }
}

function UserMessage({ item }: { item: Extract<TranscriptItem, { type: "user" }> }) {
  const name = item.from.includes("@") ? personName(item.from) : item.from;
  return (
    <Message align="end" id={item.key}>
      <MessageContent className="gap-1.5">
        <Bubble align="end" variant="muted">
          <BubbleContent>
            {/* Prompts often start with a "# Title"; keep the bubble at body size like a chat message. */}
            <Markdown className="text-sm [&_h1]:my-1 [&_h1]:text-sm [&_h1]:font-semibold [&_h2]:my-1 [&_h2]:text-sm [&_h2]:font-semibold [&_h3]:my-1 [&_h3]:text-sm [&_h3]:font-semibold">{item.text}</Markdown>
          </BubbleContent>
        </Bubble>
        <SentAttachments attachments={item.attachments} align="end" />
        <MessageFooter className="gap-1.5 px-0 font-normal">
          <PersonAvatar name={item.from} size={20} />
          <span className="font-semibold text-foreground">{name}</span>
          <button type="button" className="hover:text-foreground" onClick={() => void navigator.clipboard?.writeText(`${location.origin}${location.pathname}#${item.key}`)} suppressHydrationWarning>
            · {relativeTime(item.at)}
          </button>
        </MessageFooter>
      </MessageContent>
    </Message>
  );
}

/** One Reasoning line inside a Trace: closed by default, the thinking inside. */
function Reasoning({ text, durationMs }: { text: string; durationMs?: number }) {
  const line = (
    <TraceLine>
      <TraceIcon>
        <Brain />
      </TraceIcon>
      <TraceTitle>{reasoningTitle(durationMs)}</TraceTitle>
    </TraceLine>
  );
  if (!text) return line;
  return (
    <TraceCollapsible>
      <TraceCollapsibleTrigger>{line}</TraceCollapsibleTrigger>
      <TraceCollapsibleContent className="text-xs leading-5 whitespace-pre-wrap italic">{text}</TraceCollapsibleContent>
    </TraceCollapsible>
  );
}

function WorkGroup({ durationMs, steps, working }: { durationMs: number; steps: Step[]; working?: boolean }) {
  if (!steps.length) return null;
  return (
    <Trace>
      <TraceCollapsible defaultOpen={working}>
        <TraceCollapsibleTrigger>
          <TraceLine status={working ? "running" : undefined}>
            <TraceTitle>
              {workTitle(durationMs, Boolean(working))}
              <span className="sr-only">: {workSummary(steps)}</span>
            </TraceTitle>
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent>
          <Trace>
            {steps.map((s, i) => (
              <StepLine key={i} step={s} />
            ))}
          </Trace>
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  );
}

const STEP_ICON: Record<Step["kind"], React.ReactNode> = {
  command: <Terminal />,
  push: <GitBranch />,
  tool: <Wrench />,
  reasoning: <Brain />,
  error: <AlertCircle />,
};

/** A Tool line: a plain line without output, a collapsible with its output in a Code Block. */
function StepLine({ step }: { step: Step }) {
  if (step.kind === "reasoning") return <Reasoning text={step.output ?? ""} durationMs={step.durationMs} />;
  const status = stepStatus(step);
  const line = (
    <TraceLine status={status}>
      <TraceIcon>{STEP_ICON[step.kind]}</TraceIcon>
      <TraceTitle>
        {step.label}
        {step.detail && <span className={cn("ml-1.5", step.kind === "command" && "font-mono text-[12px]")}>{step.detail}</span>}
      </TraceTitle>
    </TraceLine>
  );
  if (!step.output) return line;
  return (
    <TraceCollapsible>
      <TraceCollapsibleTrigger>{line}</TraceCollapsibleTrigger>
      <TraceCollapsibleContent>
        <CodeBlock size="sm">
          <CodeBlockHeader>
            <CodeBlockTitle className={cn(step.isError && "text-destructive")}>Output{step.isError ? " (error)" : ""}</CodeBlockTitle>
          </CodeBlockHeader>
          <CodeBlockContent wrap className="max-h-72 text-xs">
            {step.output}
          </CodeBlockContent>
        </CodeBlock>
      </TraceCollapsibleContent>
    </TraceCollapsible>
  );
}

const TASK_ICON: Record<TaskLineStatus, React.ReactNode> = {
  done: <CircleCheck className="text-muted-foreground" />,
  active: <LoaderCircle className="animate-spin text-violet-600 dark:text-violet-400" />,
  waiting: <CircleDot className="text-orange-600 dark:text-orange-400" />,
  failed: <CircleX className="text-pink-600 dark:text-pink-400" />,
  todo: <Circle className="text-muted-foreground/60" />,
};

/** The Plan pattern: one line per stage, the current one highlighted. */
function Plan({ plan }: { plan: PlanView }) {
  return (
    <Trace className="rounded-xl border p-3">
      <TraceCollapsible defaultOpen>
        <TraceCollapsibleTrigger>
          <TraceLine className="font-medium text-foreground">
            <TraceIcon>
              <ListChecks />
            </TraceIcon>
            <TraceTitle>Tasks</TraceTitle>
            <TraceDescription className="text-xs font-normal">
              {plan.done}/{plan.total}
            </TraceDescription>
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent className="ml-0 border-l-0 pl-0">
          <Trace className="gap-0.5">
            {plan.tasks.map((t) => (
              <TraceLine
                key={t.id}
                status={t.status === "failed" ? "error" : t.status === "todo" ? "pending" : undefined}
                className={cn("h-8 w-full max-w-none rounded-md px-2", t.status === "active" || t.status === "waiting" ? "bg-muted/60 font-medium text-foreground" : undefined)}
              >
                <TraceIcon>{TASK_ICON[t.status]}</TraceIcon>
                <TraceTitle>{t.label}</TraceTitle>
                {t.attempts > 1 && <TraceDescription className="text-xs font-normal">{t.attempts} attempts</TraceDescription>}
                {t.status === "waiting" && <span className="ml-auto shrink-0 text-xs font-normal text-orange-600 dark:text-orange-400">Needs you</span>}
                {t.status === "failed" && <span className="ml-auto shrink-0 text-xs font-normal text-pink-600 dark:text-pink-400">Failed</span>}
              </TraceLine>
            ))}
          </Trace>
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  );
}

/** How much of a running subagent's activity the task page shows inline; its own page has all of it. */
const INLINE_ACTIVITY = 20;

/** The Subagent pattern: one line per run linking to its page, with its live activity nested under it. */
function Subagents({ item, showThinking, showTools }: { item: Extract<TranscriptItem, { type: "subagents" }>; showThinking: boolean; showTools: boolean }) {
  return (
    <Trace>
      <TraceCollapsible defaultOpen>
        <TraceCollapsibleTrigger>
          <TraceLine>
            <TraceIcon>
              <Bot />
            </TraceIcon>
            <TraceTitle>{subagentsTitle(item.runs.length)}</TraceTitle>
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent>
          <ul className="flex flex-col">
            {item.runs.map((r) => (
              <li key={r.id}>
                <Link href={`/runs/${r.id}?tab=agents&from=parent`} className="flex h-8 items-center gap-2.5 rounded-md px-1.5 text-sm font-medium text-foreground hover:bg-muted">
                  <StatusSquare status={r.status} size={20} />
                  <span className="shrink-0">{r.agent}</span>
                  {r.title.toLowerCase() !== r.agent.toLowerCase() && <span className="truncate text-xs font-normal text-muted-foreground">{r.title}</span>}
                </Link>
                {r.activity && r.activity.length > 0 && (
                  <div className="mt-2 mb-3 ml-3.5 border-l border-violet-500/40 pl-4 text-foreground">
                    {r.activity.length > INLINE_ACTIVITY && (
                      <Link href={`/runs/${r.id}?tab=agents&from=parent`} className="mb-3 block text-xs text-muted-foreground hover:text-foreground">
                        {r.activity.length - INLINE_ACTIVITY} earlier steps · open the full run
                      </Link>
                    )}
                    <Transcript items={r.activity.slice(-INLINE_ACTIVITY)} showThinking={showThinking} showTools={showTools} live={r.status === "running"} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  );
}
