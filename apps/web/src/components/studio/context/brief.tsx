"use client";

import { formatDistanceToNowStrict } from "date-fns";
import { ChevronDown, Newspaper } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type { ContextBrief } from "@/lib/studio/client";
import { fragmentTitle } from "@/lib/studio/context-model";
import type { ContextChange, Fragment, Proposal, Question } from "@/lib/studio/types";
import { cn } from "@/lib/utils";
import { FragmentGlyph } from "./fragment-meta";

const CHANGE: Record<ContextChange["change"], string> = { added: "Added", edited: "Changed", removed: "Removed" };

function Row({ onClick, disabled, children }: { onClick(): void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <li>
      <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-sm transition-colors hover:bg-muted disabled:cursor-default disabled:opacity-60 disabled:hover:bg-transparent"
      >
        {children}
      </button>
    </li>
  );
}

function Group({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <section className="min-w-0">
      <h3 className="mb-1 px-1.5 text-xs font-medium text-muted-foreground">
        {title} <span className="tabular-nums">({count})</span>
      </h3>
      <ul className="flex flex-col">{children}</ul>
    </section>
  );
}

/**
 * The Brief: where a teammate lands instead of a transcript. Five lines written from the Context,
 * what changed since their last visit, and what waits for them. Regenerated when the Context's
 * version moves. Nobody's prompts are shown here.
 */
export function Brief({
  brief,
  open,
  onOpenChange,
  reason,
  since,
  needs,
  proposalsToDecide,
  nameOf,
  onGo,
  onProposals,
}: {
  brief?: ContextBrief;
  open: boolean;
  onOpenChange(open: boolean): void;
  reason: "new" | "returning" | "current";
  since: ContextChange[];
  needs: { questions: Question[]; reviews: Fragment[] };
  proposalsToDecide: Proposal[];
  nameOf(user: string): string;
  onGo(fragmentId: string): void;
  onProposals(): void;
}) {
  const waiting = needs.questions.length + needs.reviews.length + proposalsToDecide.length;
  return (
    <section aria-label="Brief" className="mb-4 rounded-xl border bg-card shadow-xs">
      <button type="button" aria-expanded={open} onClick={() => onOpenChange(!open)} className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm transition-colors hover:bg-muted/50">
        <Newspaper className="size-4 shrink-0 text-muted-foreground" />
        <span className="font-medium">Brief</span>
        <span className="min-w-0 flex-1 truncate text-muted-foreground">
          {reason === "new" ? "New here? Start with this." : reason === "returning" ? "Welcome back. Here is what moved." : open ? "" : (brief?.lines[0] ?? "")}
        </span>
        {!open && waiting > 0 && <span className="shrink-0 rounded-full bg-amber-500/15 px-2 text-xs font-medium text-amber-700 tabular-nums dark:text-amber-300">{waiting} need you</span>}
        <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform duration-200", open && "rotate-180")} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2, ease: "easeOut" }} className="overflow-hidden">
            <div className="flex flex-col gap-4 border-t px-3 py-3">
              {brief ? (
                <ul className="flex flex-col gap-1.5 px-1.5 text-[15px] leading-6">
                  {brief.lines.map((line, i) => (
                    <li key={i} className={cn(i === 0 && "font-medium")}>
                      {line}
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="flex flex-col gap-2 px-1.5" aria-busy>
                  {[80, 64, 72].map((w) => (
                    <div key={w} className="h-3.5 animate-pulse rounded-full bg-muted" style={{ width: `${w}%` }} />
                  ))}
                </div>
              )}
              {(since.length > 0 || waiting > 0) && (
                <div className="flex flex-col gap-4">
                  {since.length > 0 && (
                    <Group title="Since your last visit" count={since.length}>
                      {since.slice(0, 6).map((c) => (
                        <Row key={c.fragmentId} disabled={c.change === "removed"} onClick={() => onGo(c.fragmentId)}>
                          <FragmentGlyph type={c.type} className="size-3.5 shrink-0" />
                          <span className="min-w-0 flex-1 truncate">{c.title}</span>
                          <span className="shrink-0 text-xs text-muted-foreground">
                            {CHANGE[c.change]} by {c.by === "agent" ? "the agent" : nameOf(c.by)}
                          </span>
                        </Row>
                      ))}
                      {since.length > 6 && <li className="px-1.5 py-1 text-xs text-muted-foreground">and {since.length - 6} more</li>}
                    </Group>
                  )}
                  {waiting > 0 && (
                    <Group title="Needs you" count={waiting}>
                      {needs.questions.map((q) => (
                        <Row key={q.id} onClick={() => onGo(q.fragmentId)}>
                          <FragmentGlyph type="question" className="size-3.5 shrink-0" />
                          <span className="min-w-0 flex-1 truncate">{q.spec.title}</span>
                          <span className="shrink-0 text-xs text-muted-foreground">Question</span>
                        </Row>
                      ))}
                      {proposalsToDecide.map((p) => (
                        <Row key={p.id} onClick={onProposals}>
                          <FragmentGlyph type="decision" className="size-3.5 shrink-0" />
                          <span className="min-w-0 flex-1 truncate">{p.summary}</span>
                          <span className="shrink-0 text-xs text-muted-foreground">Proposal · {formatDistanceToNowStrict(new Date(p.at))}</span>
                        </Row>
                      ))}
                      {needs.reviews.slice(0, 5).map((f) => (
                        <Row key={f.id} onClick={() => onGo(f.id)}>
                          <FragmentGlyph type={f.type} className="size-3.5 shrink-0" />
                          <span className="min-w-0 flex-1 truncate">{fragmentTitle(f.content)}</span>
                          <span className="shrink-0 text-xs text-muted-foreground">Your review</span>
                        </Row>
                      ))}
                      {needs.reviews.length > 5 && <li className="px-1.5 py-1 text-xs text-muted-foreground">and {needs.reviews.length - 5} more to review</li>}
                    </Group>
                  )}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
