"use client";

import Link from "next/link";
import { ExternalLink, GitMerge, MessageSquare, Square, X } from "lucide-react";
import { AgentIcon, StatusSquare } from "@/components/kiln/run-visuals";
import { Button } from "@/components/ui/button";
import { Item, ItemContent, ItemDescription, ItemFooter, ItemMedia, ItemTitle } from "@/components/ui/item";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AGENT_TYPE_LABEL } from "@/lib/agent-catalog";
import type { RunStatus } from "@/lib/run-tree";
import { chatTree, REPORT_REASON_LABEL } from "@/lib/studio/model";
import type { Activity, Chat } from "@/lib/studio/types";
import { cn } from "@/lib/utils";

export const RUN_STATUS_LABEL: Record<RunStatus, string> = {
  running: "Running",
  blocked: "Needs you",
  complete: "Done",
  failed: "Failed",
  cancelled: "Stopped",
};

export function agentTypeLabel(type: string | undefined): string | undefined {
  return type ? (AGENT_TYPE_LABEL[type] ?? type) : undefined;
}

/** One row of the Tasks panel: the run's status square, the chat, its agent type, and Stop. */
function TaskRow({
  chat,
  status,
  child,
  active,
  onOpen,
  onStop,
}: {
  chat: Chat;
  status: RunStatus;
  child: boolean;
  active: boolean;
  onOpen: () => void;
  onStop?: () => void;
}) {
  const type = agentTypeLabel(chat.agentType);
  return (
    <li className={cn("group/task flex items-center gap-1 rounded-lg pr-1 hover:bg-muted", active && "bg-muted", child && "ml-5")}>
      <button
        type="button"
        onClick={onOpen}
        aria-current={active ? "true" : undefined}
        className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2 py-1.5 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <StatusSquare status={status} size={20} />
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-medium">{chat.title}</span>
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {chat.agentType && <AgentIcon agent={chat.agentType} size={14} />}
            {type ?? (child ? "Subagent" : "Lead")}
            <span aria-hidden>·</span>
            {RUN_STATUS_LABEL[status]}
          </span>
        </span>
      </button>
      {chat.runId && (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Open run"
                render={<Link href={`/runs/${chat.runId}`} />}
                nativeButton={false}
                className="opacity-0 group-hover/task:opacity-100 focus-visible:opacity-100"
              />
            }
          >
            <ExternalLink />
          </TooltipTrigger>
          <TooltipContent>Open run</TooltipContent>
        </Tooltip>
      )}
      {onStop && status === "running" && (
        <Tooltip>
          <TooltipTrigger render={<Button size="icon-sm" variant="ghost" aria-label={`Stop ${chat.title}`} onClick={onStop} />}>
            <Square className="fill-current" />
          </TooltipTrigger>
          <TooltipContent>Stop</TooltipContent>
        </Tooltip>
      )}
    </li>
  );
}

/** Tasks: every chat in the App as a tree, lead chats with their subagent runs under them. */
export function TasksPanel({
  chats,
  statusOf,
  active,
  onOpen,
  onStop,
  onClose,
}: {
  chats: Chat[];
  statusOf: (c: Chat) => RunStatus;
  active?: string;
  onOpen: (id: string) => void;
  onStop: (c: Chat) => void;
  onClose: () => void;
}) {
  const tree = chatTree(chats);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 px-4">
        <span className="text-sm font-medium">Tasks</span>
        <span className="text-xs text-muted-foreground tabular-nums">{chats.length}</span>
        <Button size="icon-sm" variant="ghost" aria-label="Close tasks" onClick={onClose} className="ml-auto">
          <X />
        </Button>
      </div>
      {chats.length === 0 ? (
        <div className="px-4 py-10 text-center text-sm text-muted-foreground">No chats yet</div>
      ) : (
        <ul className="flex min-h-0 flex-col gap-0.5 overflow-y-auto px-2 pb-4">
          {tree.flatMap(({ chat, children }) => [
            <TaskRow key={chat.id} chat={chat} status={statusOf(chat)} child={false} active={chat.id === active} onOpen={() => onOpen(chat.id)} />,
            ...children.map((c) => (
              <TaskRow
                key={c.id}
                chat={c}
                status={statusOf(c)}
                child
                active={c.id === active}
                onOpen={() => onOpen(c.id)}
                onStop={c.runId ? () => onStop(c) : undefined}
              />
            )),
          ])}
        </ul>
      )}
    </div>
  );
}

/** A child chat's report in its lead's thread: the Subagent pattern as a compact card. */
export function ReportCard({
  report,
  chat,
  status,
  onOpen,
  onApply,
}: {
  report: Extract<Activity, { kind: "report" }>;
  chat?: Chat;
  status: RunStatus;
  onOpen: () => void;
  onApply?: () => Promise<void>;
}) {
  const type = agentTypeLabel(chat?.agentType);
  const tone =
    report.reason === "finished" ? "text-muted-foreground" : report.reason === "needs_input" ? "text-orange-600 dark:text-orange-400" : "text-destructive";
  return (
    <Item variant="outline" size="sm" className="bg-card shadow-xs">
      <ItemMedia>
        <StatusSquare status={status} size={24} />
      </ItemMedia>
      <ItemContent className="min-w-0">
        <ItemTitle className="line-clamp-1">{report.title}</ItemTitle>
        <ItemDescription className="flex items-center gap-1.5 text-xs">
          {chat?.agentType && <AgentIcon agent={chat.agentType} size={14} />}
          {chat?.title}
          {type && <span>· {type}</span>}
          <span className={cn("font-medium", tone)}>· {REPORT_REASON_LABEL[report.reason]}</span>
        </ItemDescription>
      </ItemContent>
      {report.summary && <p className="basis-full text-sm text-muted-foreground">{report.summary}</p>}
      <ItemFooter className="justify-start">
        <Button size="xs" variant="outline" onClick={onOpen}>
          <MessageSquare data-icon="inline-start" />
          Open chat
        </Button>
        {onApply && report.reason === "finished" && (
          <Button size="xs" variant="outline" onClick={() => void onApply()}>
            <GitMerge data-icon="inline-start" />
            Apply
          </Button>
        )}
      </ItemFooter>
    </Item>
  );
}
