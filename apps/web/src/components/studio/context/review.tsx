"use client";

import { formatDistanceToNowStrict } from "date-fns";
import { Check, CircleCheck, CircleDashed, MessageSquare, MessageSquareWarning, X } from "lucide-react";
import { motion } from "motion/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { fragmentTitle } from "@/lib/studio/context-model";
import { FunctionalRole, type Fragment, type Member, type SignOff, type Thread } from "@/lib/studio/types";
import { cn } from "@/lib/utils";
import { FragmentGlyph, ROLE_LABEL } from "./fragment-meta";

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

/** Where a sign-off stands against the fragment as it is now. */
export function reviewState(f: Fragment, role: FunctionalRole, signoffs: SignOff[]): { state: "waiting" | "approved" | "changes" | "stale"; signoff?: SignOff } {
  const signoff = signoffs.find((s) => s.fragmentId === f.id && s.role === role);
  if (!signoff) return { state: "waiting" };
  return { state: signoff.version < f.version ? "stale" : signoff.state, signoff };
}

/**
 * My review: the fragments waiting for the caller's role, each with where it sits in the Context so
 * it reads out of place. A sign-off is for the fragment's version and goes stale when it changes.
 */
export function ReviewPanel({
  fragments,
  sections,
  signoffs,
  me,
  nameOf,
  onRole,
  onSignOff,
  onGo,
  onDiscuss,
  onClose,
}: {
  fragments: Fragment[];
  /** Per fragment id: the section it is under. */
  sections: Record<string, string>;
  signoffs: SignOff[];
  me: Member;
  nameOf(user: string): string;
  onRole(role: FunctionalRole): void;
  onSignOff(fragmentId: string, state: "approved" | "changes"): void;
  onGo(fragmentId: string): void;
  onDiscuss(fragmentId: string): void;
  onClose(): void;
}) {
  const mine = fragments.filter((f) => f.reviewerRoles.includes(me.role)).map((f) => ({ f, ...reviewState(f, me.role, signoffs) }));
  const open = mine.filter((x) => x.state === "waiting" || x.state === "stale").length;
  return (
    <motion.aside aria-label="My review" {...slide} className={panel}>
      <PanelHeader title="My review" note={`${open} waiting`} onClose={onClose}>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          Reviewing as
          <select aria-label="Your role" value={me.role} onChange={(e) => onRole(e.target.value as FunctionalRole)} className="h-7 rounded-md border bg-background px-1.5 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
            {FunctionalRole.options.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
        </label>
      </PanelHeader>
      <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
        {mine.length === 0 && <li className="py-8 text-center text-sm text-pretty text-muted-foreground">Nothing in the Context waits for {ROLE_LABEL[me.role]}&apos;s review. The agent names reviewers as it writes, and anyone can ask for a role&apos;s review from a fragment&apos;s comments.</li>}
        {mine.map(({ f, state, signoff }) => (
          <li key={f.id} className="flex flex-col gap-2 rounded-xl border bg-card p-2.5 shadow-xs">
            <button type="button" onClick={() => onGo(f.id)} className="flex items-start gap-2 rounded-md text-left transition-colors hover:text-foreground">
              <FragmentGlyph type={f.type} className="mt-0.5 size-4 shrink-0" />
              <span className="flex min-w-0 flex-col">
                <span className="text-xs text-muted-foreground">{sections[f.id] ?? "Context"}</span>
                <span className="text-sm leading-snug">{fragmentTitle(f.content, 220)}</span>
              </span>
            </button>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className={cn("flex min-w-0 flex-1 items-center gap-1.5 text-xs", state === "approved" ? "text-emerald-700 dark:text-emerald-400" : state === "waiting" ? "text-muted-foreground" : "text-amber-700 dark:text-amber-400")}>
                {state === "approved" ? <CircleCheck className="size-3.5 shrink-0" /> : state === "changes" ? <MessageSquareWarning className="size-3.5 shrink-0" /> : <CircleDashed className="size-3.5 shrink-0" />}
                <span className="truncate">
                  {state === "waiting" && "Waiting for you"}
                  {state === "approved" && `Looks good · ${signoff!.by === me.user ? "you" : nameOf(signoff!.by)} · ${ago(signoff!.at)}`}
                  {state === "changes" && `Needs changes · ${signoff!.by === me.user ? "you" : nameOf(signoff!.by)} · ${ago(signoff!.at)}`}
                  {state === "stale" && "Changed since it was signed off"}
                </span>
              </span>
              <Button size="xs" variant="ghost" onClick={() => onDiscuss(f.id)}>
                <MessageSquare data-icon="inline-start" />
                Discuss
              </Button>
              <Button
                size="xs"
                variant="outline"
                onClick={() => {
                  onSignOff(f.id, "changes");
                  onDiscuss(f.id);
                }}
              >
                Needs changes
              </Button>
              <Button size="xs" disabled={state === "approved"} onClick={() => onSignOff(f.id, "approved")}>
                <Check data-icon="inline-start" />
                Looks good
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </motion.aside>
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
  onRequestReview,
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
  onRequestReview(fragmentId: string, role: FunctionalRole): void;
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
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            Ask for a review from
            <select
              aria-label="Ask a role to review this"
              value=""
              onChange={(e) => e.target.value && onRequestReview(fragment.id, e.target.value as FunctionalRole)}
              className="h-7 rounded-md border bg-background px-1.5 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <option value="">a role…</option>
              {FunctionalRole.options
                .filter((r) => !fragment.reviewerRoles.includes(r))
                .map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </option>
                ))}
            </select>
            {fragment.reviewerRoles.length > 0 && <span className="truncate">Reviewed by {fragment.reviewerRoles.map((r) => ROLE_LABEL[r]).join(", ")}</span>}
          </label>
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
