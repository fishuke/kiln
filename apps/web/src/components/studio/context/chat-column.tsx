"use client";

import { formatDistanceToNowStrict } from "date-fns";
import { MessageSquare } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { Markdown } from "@/components/kiln/markdown";
import { chatMessages } from "@/lib/studio/context-model";
import type { ContextTurn } from "@/lib/studio/types";
import { cn } from "@/lib/utils";

/**
 * The chat layout's left column: the App's one thread as a conversation, oldest first. The Context
 * itself stays the source of truth on the right; this is only how the talk around it reads.
 */
export function ChatColumn({ turns, me, nameOf, empty }: { turns: ContextTurn[]; me: string; nameOf(user: string): string; empty?: React.ReactNode }) {
  const messages = useMemo(() => chatMessages(turns), [turns]);
  const end = useRef<HTMLDivElement>(null);
  const last = messages.at(-1)?.id;
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [last]);

  if (!messages.length)
    return (
      empty ?? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <div className="flex size-10 items-center justify-center rounded-xl border bg-background text-muted-foreground">
            <MessageSquare className="size-5" />
          </div>
          <p className="max-w-xs text-sm text-pretty text-muted-foreground">Talk to the agent here. The Context fills in on the right as you go.</p>
        </div>
      )
    );

  return (
    <div className="min-h-0 flex-1 overflow-y-auto" aria-label="Chat" role="log">
      <ol className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 pt-4 pb-6">
        {messages.map((m) => {
          const mine = m.from === me;
          const agent = m.from === "agent";
          return (
            <li key={m.id} className={cn("flex flex-col gap-1", mine ? "items-end" : "items-start")}>
              <span className="px-1 text-xs text-muted-foreground">
                {mine ? "You" : agent ? "Agent" : nameOf(m.from)} · {formatDistanceToNowStrict(new Date(m.at))} ago
              </span>
              {agent ? (
                <Markdown className={cn("max-w-full text-sm leading-relaxed", m.failed && "text-destructive")}>{m.text}</Markdown>
              ) : (
                <p
                  className={cn(
                    "max-w-[85%] rounded-2xl px-3.5 py-2 text-sm leading-snug whitespace-pre-wrap",
                    mine ? "bg-primary text-primary-foreground" : "bg-muted",
                    m.live && "opacity-90",
                  )}
                >
                  {m.text}
                </p>
              )}
            </li>
          );
        })}
      </ol>
      <div ref={end} />
    </div>
  );
}
