"use client";

import { ArrowUp, LoaderCircle, Sparkles, X } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { fragmentTitle } from "@/lib/studio/context-model";

/** The text "Ask the agent" is about: a selection or a whole fragment. */
export type AskTarget = { blockId: string; range: { from: number; to: number }; text: string };

const QUICK = ["Make it shorter", "Make it more specific", "Use plainer words"];

/**
 * "Ask the agent" on a piece of the Context. An editor's request closes this and streams into the
 * document as a suggestion with Accept and Reject. A viewer can't write, so the agent's text comes
 * back here and goes to an editor as a proposal.
 */
export function AskAgent({
  target,
  canEdit,
  style,
  onSuggest,
  onDraft,
  onPropose,
  onClose,
}: {
  target: AskTarget;
  canEdit: boolean;
  style: React.CSSProperties;
  onSuggest(instruction: string): void;
  onDraft(instruction: string, onChunk: (chunk: string) => void): Promise<string>;
  onPropose(to: string): Promise<void>;
  onClose(): void;
}) {
  const [instruction, setInstruction] = useState("");
  const [drafted, setDrafted] = useState<string>();
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus({ preventScroll: true }), []);

  const send = async (text: string) => {
    const what = text.trim();
    if (!what || busy) return;
    if (canEdit) return onSuggest(what);
    setBusy(true);
    setDrafted("");
    try {
      setDrafted(await onDraft(what, (chunk) => setDrafted((d) => (d ?? "") + chunk)));
    } catch {
      setDrafted(undefined);
    } finally {
      setBusy(false);
    }
  };

  return (
    <motion.div
      role="dialog"
      aria-label="Ask the agent"
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.15, ease: "easeOut" }}
      style={style}
      className="absolute z-20 flex w-[min(360px,100%)] flex-col gap-2 rounded-xl border bg-popover p-2 text-popover-foreground shadow-lg"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
        <Sparkles className="size-3.5 shrink-0 text-violet-600 dark:text-violet-400" />
        <span className="min-w-0 flex-1 truncate">“{fragmentTitle(target.text, 56)}”</span>
        <Button size="icon-xs" variant="ghost" aria-label="Close" onClick={onClose}>
          <X />
        </Button>
      </div>
      {drafted === undefined ? (
        <>
          <form
            className="flex items-center gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              void send(instruction);
            }}
          >
            <input ref={input} aria-label="What should change?" value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder="What should change?" className="ctx-input h-8 flex-1" />
            <Button type="submit" size="icon-sm" aria-label="Ask" disabled={!instruction.trim()}>
              <ArrowUp />
            </Button>
          </form>
          <div className="flex flex-wrap gap-1">
            {QUICK.map((q) => (
              <Button key={q} size="xs" variant="outline" className="rounded-full font-normal" onClick={() => void send(q)}>
                {q}
              </Button>
            ))}
          </div>
          {!canEdit && <p className="px-1 text-xs text-muted-foreground">You are a viewer: the change goes to an editor as a proposal.</p>}
        </>
      ) : (
        <>
          <div className="rounded-lg bg-muted/50 px-2.5 py-2 text-sm leading-relaxed">
            <del className="ctx-suggest-del">{target.text}</del> <ins className="ctx-suggest-add">{drafted}</ins>
            {busy && <LoaderCircle className="ml-1 inline size-3 animate-spin text-muted-foreground" />}
          </div>
          <div className="flex justify-end gap-1.5">
            <Button size="sm" variant="ghost" onClick={onClose}>
              Discard
            </Button>
            <Button size="sm" disabled={busy || !drafted} onClick={() => void onPropose(drafted)}>
              Propose
            </Button>
          </div>
        </>
      )}
    </motion.div>
  );
}
