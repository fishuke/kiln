"use client";

import Link from "next/link";
import { Bot, ChevronDown, ChevronRight, Circle, CircleAlert, CircleCheck, CircleDot, CircleX, GitBranch, ListChecks, LoaderCircle, Terminal, Wrench } from "lucide-react";
import { useState } from "react";
import { SentAttachments } from "@/components/kiln/attachments";
import { GateCard } from "@/components/kiln/gate-card";
import { Markdown } from "@/components/kiln/markdown";
import { PersonAvatar, StatusSquare, personName } from "@/components/kiln/run-visuals";
import type { Step, TranscriptItem } from "@/lib/run-detail";
import type { PlanView, TaskLineStatus } from "@/lib/run-plan";
import { relativeTime, shortDuration } from "@/lib/run-tree";
import { cn } from "@/lib/utils";

/** `live`: the agent is still working, so its latest steps start open. */
export function Transcript({
  items,
  showThinking,
  showTools,
  prUrl,
  previewUrl,
  live,
}: {
  items: TranscriptItem[];
  showThinking: boolean;
  showTools: boolean;
  prUrl?: string;
  previewUrl?: string;
  live?: boolean;
}) {
  return (
    <div className="flex flex-col gap-5">
      {items.map((it, i) => {
        if (it.type === "user") return <UserMessage key={it.key} item={it} />;
        if (it.type === "agent")
          return (
            <div key={it.key}>
              <Markdown className="text-sm leading-6 [&_a]:text-violet-600 dark:[&_a]:text-violet-400">{it.text}</Markdown>
              <div className="mt-1 text-xs text-muted-foreground" suppressHydrationWarning>
                {relativeTime(it.at)}
              </div>
            </div>
          );
        if (it.type === "reasoning") return showThinking ? <Reasoning key={it.key} text={it.text} durationMs={it.durationMs} /> : null;
        if (it.type === "work")
          return showTools ? <WorkGroup key={it.key} durationMs={it.durationMs} steps={it.steps.filter((s) => showThinking || s.kind !== "reasoning")} working={live && i === items.length - 1} /> : null;
        if (it.type === "subagents") return <Subagents key={it.key} item={it} showThinking={showThinking} showTools={showTools} />;
        if (it.type === "tasks") return <TasksCard key={it.key} plan={it.plan} />;
        if (it.type === "waiting")
          return (
            <div key={it.key} className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-blue-500" />
              <span>{it.text}</span>
            </div>
          );
        if (it.type === "gate") {
          // The foreman usually posts the same text it asks about; show it once.
          const head = it.gate.question?.slice(0, 80);
          const said = Boolean(head && items.some((x) => x.type === "agent" && x.text.includes(head)));
          return <GateCard key={it.key} gate={it.gate} prUrl={prUrl} previewUrl={previewUrl} hideQuestion={said && it.gate.kind !== "question"} />;
        }
        return (
          <div key={it.key} className={cn("flex items-start gap-2 text-xs text-muted-foreground", it.tone === "error" && "text-red-600 dark:text-red-400")}>
            {it.tone === "error" ? <CircleAlert className="mt-px size-3.5 shrink-0" /> : <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-muted-foreground/50" />}
            <span>{it.text}</span>
          </div>
        );
      })}
    </div>
  );
}

function UserMessage({ item }: { item: Extract<TranscriptItem, { type: "user" }> }) {
  const name = item.from.includes("@") ? personName(item.from) : item.from;
  return (
    <div className="flex flex-col items-end">
      <div className="max-w-[80%] rounded-2xl bg-muted px-3 py-2 text-sm">
        {/* Prompts often start with a "# Title"; keep the bubble at body size like a chat message. */}
        <Markdown className="text-sm [&_h1]:my-1 [&_h1]:text-sm [&_h1]:font-semibold [&_h2]:my-1 [&_h2]:text-sm [&_h2]:font-semibold [&_h3]:my-1 [&_h3]:text-sm [&_h3]:font-semibold">{item.text}</Markdown>
      </div>
      <SentAttachments attachments={item.attachments} align="end" />
      <div className="mt-1.5 flex items-center gap-1.5 text-xs">
        <PersonAvatar name={item.from} size={20} />
        <span className="font-semibold">{name}</span>
        <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => void navigator.clipboard?.writeText(`${location.origin}${location.pathname}#${item.key}`)} suppressHydrationWarning>
          · {relativeTime(item.at)}
        </button>
      </div>
    </div>
  );
}

function Disclosure({ label, children, defaultOpen = false, icon, className }: { label: React.ReactNode; children: React.ReactNode; defaultOpen?: boolean; icon?: React.ReactNode; className?: string }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={className}>
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex max-w-full items-center gap-2 text-xs text-muted-foreground hover:text-foreground">
        {icon}
        <span className="min-w-0 truncate">{label}</span>
        {open ? <ChevronDown className="size-3.5 shrink-0" /> : <ChevronRight className="size-3.5 shrink-0" />}
      </button>
      {open && children}
    </div>
  );
}

function Reasoning({ text, durationMs }: { text: string; durationMs: number }) {
  return (
    <Disclosure label={durationMs ? `Reasoned for ${shortDuration(durationMs)}` : "Reasoned"}>
      <div className="mt-2 ml-1 border-l pl-6 text-xs leading-5 whitespace-pre-wrap text-muted-foreground italic">{text}</div>
    </Disclosure>
  );
}

function summary(steps: Step[]) {
  const commands = steps.filter((s) => s.kind === "command").length;
  const tools = steps.filter((s) => s.kind === "tool").length;
  const parts = [];
  if (commands) parts.push(`Ran ${commands} command${commands === 1 ? "" : "s"}`);
  if (tools) parts.push(`Called ${tools} tool${tools === 1 ? "" : "s"}`);
  return parts.join(" · ");
}

function WorkGroup({ durationMs, steps, working }: { durationMs: number; steps: Step[]; working?: boolean }) {
  if (!steps.length) return null;
  return (
    <Disclosure
      defaultOpen={working}
      label={
        <>
          {working ? "Working" : "Worked"} for {shortDuration(durationMs)}
          <span className="sr-only">: {summary(steps)}</span>
        </>
      }
    >
      <ul className="mt-2 ml-1 flex flex-col gap-1 border-l py-1 pl-6">
        {steps.map((s, i) => (
          <li key={i}>
            <StepRow step={s} />
          </li>
        ))}
      </ul>
    </Disclosure>
  );
}

function StepRow({ step }: { step: Step }) {
  const icon = step.kind === "command" ? <Terminal className="size-4 shrink-0" /> : step.kind === "push" ? <GitBranch className="size-4 shrink-0" /> : step.kind === "tool" ? <Wrench className="size-4 shrink-0" /> : undefined;
  const label =
    step.kind === "reasoning" ? (
      <>{step.durationMs ? `Reasoned for ${shortDuration(step.durationMs)}` : "Reasoned"}</>
    ) : (
      <>
        {step.label}
        {step.detail && <span className={cn("ml-1.5", step.kind === "command" && "font-mono text-[12px]")}>{step.detail}</span>}
      </>
    );
  if (!step.output) {
    return (
      <div className="flex h-7 items-center gap-2 text-xs text-muted-foreground">
        {icon}
        <span className="min-w-0 truncate">{label}</span>
      </div>
    );
  }
  return (
    <Disclosure icon={icon} label={label} className="py-1">
      {step.kind === "reasoning" ? (
        <div className="mt-1.5 ml-1 border-l pl-5 text-xs whitespace-pre-wrap text-muted-foreground italic">{step.output}</div>
      ) : (
        <div className="mt-2 mb-1">
          <div className={cn("mb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase", step.isError && "text-red-600 dark:text-red-400")}>Output{step.isError ? " (error)" : ""}</div>
          <pre className="max-h-72 overflow-auto rounded-lg bg-muted p-3 font-mono text-xs leading-5 whitespace-pre-wrap">{step.output}</pre>
        </div>
      )}
    </Disclosure>
  );
}

const TASK_ICON: Record<TaskLineStatus, React.ReactNode> = {
  done: <CircleCheck className="size-4 text-muted-foreground" />,
  active: <LoaderCircle className="size-4 animate-spin text-violet-600 dark:text-violet-400" />,
  waiting: <CircleDot className="size-4 text-orange-600 dark:text-orange-400" />,
  failed: <CircleX className="size-4 text-pink-600 dark:text-pink-400" />,
  todo: <Circle className="size-4 text-muted-foreground/60" />,
};

/** The plan as a checklist: one line per stage, the current one highlighted. */
function TasksCard({ plan }: { plan: PlanView }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="rounded-xl border">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex h-11 w-full items-center gap-2 px-3 text-sm font-medium">
        <ListChecks className="size-4" />
        Tasks
        <span className="ml-auto text-xs font-normal text-muted-foreground">
          {plan.done}/{plan.total}
        </span>
        {open ? <ChevronDown className="size-4 text-muted-foreground" /> : <ChevronRight className="size-4 text-muted-foreground" />}
      </button>
      {open && (
        <ul className="flex flex-col gap-0.5 border-t p-2">
          {plan.tasks.map((t) => (
            <li key={t.id} className={cn("flex h-8 items-center gap-2.5 rounded-md px-2 text-sm", t.status === "todo" || t.status === "done" ? "text-muted-foreground" : "bg-muted/60 font-medium")}>
              {TASK_ICON[t.status]}
              <span className="truncate">{t.label}</span>
              {t.attempts > 1 && <span className="shrink-0 text-xs font-normal text-muted-foreground">{t.attempts} attempts</span>}
              {t.status === "waiting" && <span className="ml-auto shrink-0 text-xs font-normal text-orange-600 dark:text-orange-400">Needs you</span>}
              {t.status === "failed" && <span className="ml-auto shrink-0 text-xs font-normal text-pink-600 dark:text-pink-400">Failed</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** How much of a running subagent's activity the task page shows inline; its own page has all of it. */
const INLINE_ACTIVITY = 20;

function Subagents({ item, showThinking, showTools }: { item: Extract<TranscriptItem, { type: "subagents" }>; showThinking: boolean; showTools: boolean }) {
  const n = item.runs.length;
  return (
    <Disclosure defaultOpen icon={<Bot className="size-4" />} label={`Launched ${n} subagent${n === 1 ? "" : "s"}`}>
      <ul className="mt-2 ml-2 flex flex-col border-l pl-4">
        {item.runs.map((r) => (
          <li key={r.id}>
            <Link href={`/runs/${r.id}?tab=agents&from=parent`} className="flex h-8 items-center gap-2.5 rounded-md px-1.5 text-sm font-medium hover:bg-muted">
              <StatusSquare status={r.status} size={20} />
              <span className="shrink-0">{r.agent}</span>
              {r.title.toLowerCase() !== r.agent.toLowerCase() && <span className="truncate text-xs font-normal text-muted-foreground">{r.title}</span>}
            </Link>
            {r.activity && r.activity.length > 0 && (
              <div className="mt-2 mb-3 ml-3.5 border-l border-violet-500/40 pl-4">
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
    </Disclosure>
  );
}
