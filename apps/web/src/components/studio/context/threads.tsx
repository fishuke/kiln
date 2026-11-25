"use client";

import { formatDistanceToNowStrict } from "date-fns";
import { X } from "lucide-react";
import { motion } from "motion/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { fragmentTitle } from "@/lib/studio/context-model";
import type { Fragment, Member, Thread } from "@/lib/studio/types";
import { cn } from "@/lib/utils";
import { FragmentGlyph } from "./fragment-meta";

const panel = "absolute inset-y-0 right-0 z-30 flex w-[min(440px,100%)] flex-col border-l bg-background shadow-xl";
const slide = { initial: { x: "100%" }, animate: { x: 0 }, exit: { x: "100%" }, transition: { duration: 0.2, ease: "easeOut" as const } };
const ago = (iso: string) => `${formatDistanceToNowStrict(new Date(iso))} ago`;

function PanelHeader({ title, note, onClose, children }: { title: string; note?: string; onClose(): void; children?: React.ReactNode }) {
  return (
    <header className="flex min-h-11 shrink-0 flex-wrap items-center gap-2 border-b py-1.5 pr-1.5 pl-3">
      <span className="text-sm font-medium">{title}</span>
      {note && <span className="text-xs text-muted-foreground">{note}</span>}
      <span className="ml-auto flex items-center gap-1.5">
        {children}
        <Button size="icon-sm" variant="ghost" aria-label={`Close ${title.toLowerCase()}`} onClick={onClose}>
          <X />
        </Button>
      </span>
    </header>
  );
}

/**
 * Threads: comments on fragments. Opened from a fragment it shows that fragment's threads and a box
 * to start one; opened from the top bar it lists every open thread in the Context.
 */
export function ThreadsPanel({
  threads,
  fragments,
  focus,
  me,
  nameOf,
  onComment,
  onResolve,
  onGo,
  onAll,
  onClose,
}: {
  threads: Thread[];
  fragments: Fragment[];
  /** The fragment the panel was opened on. */
  focus?: string;
  me: Member;
  nameOf(user: string): string;
  onComment(input: { fragmentId?: string; threadId?: string; text: string }): Promise<boolean>;
  onResolve(threadId: string, resolved: boolean): void;
  onGo(fragmentId: string): void;
  onAll(): void;
  onClose(): void;
}) {
  const [draft, setDraft] = useState("");
  const [replies, setReplies] = useState<Record<string, string>>({});
  const fragment = focus ? fragments.find((f) => f.id === focus) : undefined;
  const shown = threads.filter((t) => (focus ? t.fragmentId === focus : t.status === "open"));
  const start = async () => {
    if (focus && draft.trim() && (await onComment({ fragmentId: focus, text: draft }))) setDraft("");
  };
  const reply = async (id: string) => {
    const text = replies[id]?.trim();
    if (text && (await onComment({ threadId: id, text }))) setReplies((r) => ({ ...r, [id]: "" }));
  };
  return (
    <motion.aside aria-label="Threads" {...slide} className={panel}>
      <PanelHeader title={focus ? "Comments" : "Threads"} note={focus ? undefined : `${shown.length} open`} onClose={onClose}>
        {focus && (
          <Button size="xs" variant="ghost" onClick={onAll}>
            All threads
          </Button>
        )}
      </PanelHeader>
      {fragment && (
        <div className="flex flex-col gap-2 border-b bg-muted/30 px-3 py-2.5">
          <button type="button" onClick={() => onGo(fragment.id)} className="flex items-start gap-2 text-left">
            <FragmentGlyph type={fragment.type} className="mt-0.5 size-4 shrink-0" />
            <span className="text-sm leading-snug">{fragmentTitle(fragment.content, 200)}</span>
          </button>
        </div>
      )}
      <ul className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
        {shown.length === 0 && <li className="py-8 text-center text-sm text-muted-foreground">{focus ? "No comments on this yet." : "No open threads."}</li>}
        {shown.map((t) => (
          <li key={t.id} className={cn("flex flex-col gap-2 rounded-xl border bg-card p-2.5 shadow-xs", t.status === "resolved" && "opacity-70")}>
            {!focus && (
              <button type="button" onClick={() => onGo(t.fragmentId)} className="truncate text-left text-xs text-muted-foreground hover:text-foreground">
                On: {fragments.find((f) => f.id === t.fragmentId) ? t.title : `${t.title} (removed)`}
              </button>
            )}
            {t.comments.map((c) => (
              <div key={c.id} className="flex flex-col gap-0.5">
                <div className="flex items-baseline gap-2 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{c.by === me.user ? "You" : nameOf(c.by)}</span>
                  <span>{ago(c.at)}</span>
                </div>
                <p className="text-sm leading-snug whitespace-pre-wrap">{c.text}</p>
              </div>
            ))}
            <form
              className="flex items-center gap-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                void reply(t.id);
              }}
            >
              <input aria-label="Reply" placeholder="Reply" value={replies[t.id] ?? ""} onChange={(e) => setReplies((r) => ({ ...r, [t.id]: e.target.value }))} className="ctx-input h-8 min-w-0 flex-1" />
              <Button type="button" size="xs" variant="ghost" onClick={() => onResolve(t.id, t.status === "open")}>
                {t.status === "open" ? "Resolve" : "Reopen"}
              </Button>
            </form>
          </li>
        ))}
      </ul>
      {focus && (
        <form
          className="flex shrink-0 items-end gap-1.5 border-t p-2.5"
          onSubmit={(e) => {
            e.preventDefault();
            void start();
          }}
        >
          <textarea
            aria-label="New comment"
            rows={2}
            placeholder="Comment on this fragment"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void start();
              }
            }}
            className="ctx-input min-h-14 flex-1 resize-none py-1.5"
          />
          <Button type="submit" size="sm" disabled={!draft.trim()}>
            Comment
          </Button>
        </form>
      )}
    </motion.aside>
  );
}
