"use client";

import Link from "next/link";
import { ExternalLink, Square, Trash2, X } from "lucide-react";
import { StatusSquare } from "@/components/kiln/run-visuals";
import { Button } from "@/components/ui/button";
import { Confirm } from "./confirm";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { RunStatus } from "@/lib/run-tree";
import type { Chat } from "@/lib/studio/types";
import { cn } from "@/lib/utils";

export const RUN_STATUS_LABEL: Record<RunStatus, string> = {
  running: "Running",
  blocked: "Needs you",
  complete: "Done",
  failed: "Failed",
  cancelled: "Stopped",
};

/** One row of the Tasks panel: the run's status square, the chat, Open run, and Stop while it runs or Delete when it doesn't. */
function TaskRow({
  chat,
  status,
  active,
  onOpen,
  onStop,
  onDelete,
}: {
  chat: Chat;
  status: RunStatus;
  active: boolean;
  onOpen: () => void;
  onStop?: () => void;
  onDelete: () => Promise<unknown>;
}) {
  return (
    <li className={cn("group/task flex items-center gap-1 rounded-lg pr-1 hover:bg-muted", active && "bg-muted")}>
      <button
        type="button"
        onClick={onOpen}
        aria-current={active ? "true" : undefined}
        className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2 py-1.5 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <StatusSquare status={status} size={20} />
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-medium">{chat.title}</span>
          <span className="text-xs text-muted-foreground">{RUN_STATUS_LABEL[status]}</span>
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
                className="opacity-0 group-hover/task:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
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
      {chat.status !== "working" && (
        <Confirm
          trigger={
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={`Delete ${chat.title}`}
              className="opacity-0 group-hover/task:opacity-100 focus-visible:opacity-100 aria-expanded:opacity-100 pointer-coarse:opacity-100"
            >
              <Trash2 />
            </Button>
          }
          icon={<Trash2 />}
          title={`Delete ${chat.title}?`}
          description="Its messages, preview and any changes not applied to main are removed. Versions it applied stay in History."
          action="Delete"
          onConfirm={onDelete}
        />
      )}
    </li>
  );
}

/**
 * Tasks: every chat in the App with its run's status, Open run, Stop (interrupt) and Delete. Subagent runs
 * nest here once Studio's routes return the App's run trees (docs/specs/studio.md, "Chats reuse runs").
 */
export function TasksPanel({
  chats,
  statusOf,
  active,
  onOpen,
  onStop,
  onDelete,
  onClose,
}: {
  chats: Chat[];
  statusOf: (c: Chat) => RunStatus;
  active?: string;
  onOpen: (id: string) => void;
  onStop: (c: Chat) => void;
  onDelete: (c: Chat) => Promise<unknown>;
  onClose: () => void;
}) {
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
          {chats.map((c) => (
            <TaskRow
              key={c.id}
              chat={c}
              status={statusOf(c)}
              active={c.id === active}
              onOpen={() => onOpen(c.id)}
              onStop={c.runId ? () => onStop(c) : undefined}
              onDelete={() => onDelete(c)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
