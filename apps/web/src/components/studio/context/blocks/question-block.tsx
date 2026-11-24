"use client";

import { formatDistanceToNowStrict } from "date-fns";
import { Check, ChevronDown, ChevronUp, CornerDownLeft, GripVertical, Undo2 } from "lucide-react";
import { AnimatePresence, motion, Reorder } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { questionFromBlock, QUESTION_BLOCK, type DocProps } from "@/lib/studio/context-doc";
import { answerText, batchProgress, delegatedAnswer, MAX_QUESTIONS_ON_SCREEN, questionDisplay, validateAnswer, VIEWER_NOTE } from "@/lib/studio/context-model";
import type { Question, QuestionAnswer, QuestionSpec, Wireframe } from "@/lib/studio/types";
import { cn } from "@/lib/utils";
import { useContextUI } from "../context-ui";
import { FragmentGlyph } from "../fragment-meta";

type Value = string | number | boolean | string[];
type Choice = { id: string; label: string; consequence?: string; recommended?: boolean; layout?: Wireframe };

/** The options a question offers as cards or chips; a yes/no question is two of them. */
function choicesOf(spec: QuestionSpec): Choice[] {
  if (spec.kind === "single" || spec.kind === "multi" || spec.kind === "sketch") return spec.options;
  if (spec.kind === "boolean")
    return [
      { id: "true", label: spec.yes ?? "Yes", recommended: spec.recommended === true },
      { id: "false", label: spec.no ?? "No", recommended: spec.recommended === false },
    ];
  return [];
}

function startValue(spec: QuestionSpec, previous?: QuestionAnswer): Value | undefined {
  if (previous?.type === "value") return previous.value;
  if (spec.kind === "scale" || spec.kind === "rank") return (delegatedAnswer(spec) as { value: Value }).value;
  if (spec.kind === "multi") return [];
  if (spec.kind === "text") return "";
  return undefined;
}

function selectedIds(spec: QuestionSpec, value: Value | undefined): string[] {
  if (spec.kind === "boolean") return typeof value === "boolean" ? [String(value)] : [];
  if (Array.isArray(value)) return value;
  return typeof value === "string" ? [value] : [];
}

function ago(iso: string | undefined): string {
  if (!iso) return "";
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return "";
  return Date.now() - t.getTime() < 60_000 ? "just now" : `${formatDistanceToNowStrict(t)} ago`;
}

/** A layout direction drawn from a fixed set of primitives: the agent names one, it never sends markup. */
function Wire({ layout }: { layout: Wireframe }) {
  const bar = "fill-current opacity-25";
  const box = "fill-current opacity-15";
  return (
    <svg viewBox="0 0 96 60" aria-hidden className="w-full rounded-md border bg-background text-foreground">
      <rect x="6" y="6" width="30" height="4" rx="2" className="fill-current opacity-40" />
      {layout === "list" && [16, 26, 36, 46].map((y) => <rect key={y} x="6" y={y} width="84" height="6" rx="2" className={bar} />)}
      {layout === "grid" && [6, 36, 66].flatMap((x) => [16, 37].map((y) => <rect key={`${x}-${y}`} x={x} y={y} width="24" height="17" rx="3" className={box} />))}
      {layout === "split" && (
        <>
          {[16, 26, 36, 46].map((y) => (
            <rect key={y} x="6" y={y} width="28" height="6" rx="2" className={bar} />
          ))}
          <rect x="40" y="16" width="50" height="38" rx="3" className={box} />
        </>
      )}
      {layout === "feed" && (
        <>
          <rect x="24" y="16" width="48" height="24" rx="3" className={box} />
          <rect x="24" y="44" width="48" height="12" rx="3" className={bar} />
        </>
      )}
    </svg>
  );
}

function OptionCard({ choice, index, selected, settled, multi, onPick }: { choice: Choice; index: number; selected: boolean; settled: boolean; multi: boolean; onPick: () => void }) {
  return (
    <motion.button
      layout
      type="button"
      role={multi ? "checkbox" : "radio"}
      aria-checked={selected}
      disabled={settled}
      onClick={onPick}
      initial={false}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      className={cn(
        "ctx-option group/option flex min-w-0 items-start gap-2.5 rounded-lg border bg-background p-2.5 text-left text-sm text-foreground transition-[border-color,background-color,box-shadow] duration-150",
        choice.layout && "flex-col gap-2",
        multi && !choice.layout && "items-center rounded-full py-1.5 pr-3.5 pl-2.5",
        !settled && "cursor-pointer hover:border-foreground/30 hover:bg-muted/40 active:translate-y-px",
        selected && !settled && "border-foreground/60 bg-muted/50 shadow-xs",
        settled && "cursor-default border-transparent bg-transparent p-0",
      )}
    >
      {choice.layout && !settled && <Wire layout={choice.layout} />}
      <span className="flex min-w-0 items-start gap-2.5">
        {!settled && (
          <span
            aria-hidden
            className={cn(
              "mt-px flex size-5 shrink-0 items-center justify-center rounded-md border text-[11px] font-medium text-muted-foreground tabular-nums transition-colors duration-150",
              selected && "border-foreground bg-foreground text-background",
            )}
          >
            {selected ? <Check className="size-3" /> : index + 1}
          </span>
        )}
        <span className="flex min-w-0 flex-col">
          <span className="font-medium">
            {choice.label}
            {choice.recommended && !settled && <span className="ml-2 text-xs font-normal text-muted-foreground">Recommended</span>}
          </span>
          {choice.consequence && !multi && <span className="text-[13px] leading-snug text-muted-foreground">{choice.consequence}</span>}
        </span>
      </span>
    </motion.button>
  );
}

function Scale({ spec, value, onChange }: { spec: Extract<QuestionSpec, { kind: "scale" }>; value: number; onChange: (n: number) => void }) {
  const percent = ((value - spec.min) / (spec.max - spec.min)) * 100;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between text-[13px] text-muted-foreground">
        <span>{spec.minLabel}</span>
        <span className="text-base font-semibold text-foreground tabular-nums">
          {value}
          {spec.unit ? ` ${spec.unit}` : ""}
        </span>
        <span>{spec.maxLabel}</span>
      </div>
      <input
        type="range"
        aria-label={spec.title}
        min={spec.min}
        max={spec.max}
        step={spec.step ?? 1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="ctx-range"
        style={{ "--fill": `${percent}%` } as React.CSSProperties}
      />
    </div>
  );
}

function Rank({ choices, order, onChange }: { choices: Choice[]; order: string[]; onChange: (o: string[]) => void }) {
  const move = (i: number, by: number) => {
    const next = [...order];
    const j = i + by;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j]!, next[i]!];
    onChange(next);
  };
  return (
    <Reorder.Group axis="y" values={order} onReorder={onChange} className="flex flex-col gap-1.5" aria-label="Order, most important first">
      {order.map((id, i) => (
        <Reorder.Item
          key={id}
          value={id}
          className="flex cursor-grab items-center gap-2 rounded-lg border bg-background py-1.5 pr-1.5 pl-2 text-sm text-foreground select-none active:cursor-grabbing active:shadow-sm"
        >
          <GripVertical aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="w-4 shrink-0 text-xs text-muted-foreground tabular-nums">{i + 1}</span>
          <span className="min-w-0 flex-1 font-medium">{choices.find((c) => c.id === id)?.label ?? id}</span>
          <Button size="icon-xs" variant="ghost" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
            <ChevronUp />
          </Button>
          <Button size="icon-xs" variant="ghost" aria-label="Move down" disabled={i === order.length - 1} onClick={() => move(i, 1)}>
            <ChevronDown />
          </Button>
        </Reorder.Item>
      ))}
    </Reorder.Group>
  );
}

/** Moves focus to the next open question after `from` (or the first one), so a batch is answered without the mouse. */
export function focusNextQuestion(from?: HTMLElement | null) {
  const open = [...document.querySelectorAll<HTMLElement>('[data-question-open="true"]')];
  const i = from ? open.indexOf(from) : -1;
  const next = open[i + 1] ?? open.find((el) => el !== from);
  if (!next) return false;
  next.focus({ preventScroll: true });
  next.scrollIntoView({ block: "nearest", behavior: "smooth" });
  return true;
}

/**
 * A question the agent asked, rendered from its typed spec. Open, it offers options, "Something
 * else", "You decide" and Skip; answered, the same block is the decision: the chosen option stays
 * where it was, the others fold away, and "Change answer" opens it again.
 * Keys: 1–4 pick, Enter confirms, Tab moves to the next question, S skips.
 */
export function QuestionBlock({ blockId, props }: { blockId: string; props: DocProps }) {
  const ui = useContextUI();
  const q = useMemo(() => questionFromBlock(ui.appId, { id: blockId, type: QUESTION_BLOCK, props }), [ui.appId, blockId, props]);
  if (!q) return <div className="rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground">This question could not be read.</div>;
  return <QuestionView q={q} />;
}

function QuestionView({ q }: { q: Question }) {
  const ui = useContextUI();
  const { spec } = q;
  const all = ui.questions.some((x) => x.id === q.id) ? ui.questions : [q];
  const display = questionDisplay(q, all);
  const settled = display === "settled";
  const progress = batchProgress(all, q.batch.id);
  const stepper = q.batch.total > MAX_QUESTIONS_ON_SCREEN;
  const choices = choicesOf(spec);
  const multi = spec.kind === "multi";

  const [value, setValue] = useState<Value | undefined>(() => startValue(spec, q.answer));
  const [other, setOther] = useState<string | undefined>(q.status === "open" && q.answer?.type === "other" ? q.answer.text : undefined);
  const [error, setError] = useState<string>();
  const root = useRef<HTMLDivElement>(null);
  const otherInput = useRef<HTMLInputElement>(null);
  const pending = ui.proposals.find((p) => p.kind === "answer" && p.fragmentId === q.fragmentId && p.status === "open");

  // The block is one component for its whole life: when the answer changes elsewhere, follow it.
  const answerKey = JSON.stringify(q.answer ?? null);
  useEffect(() => {
    setValue(startValue(spec, q.answer));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `answerKey` is the answer
  }, [answerKey, q.status]);

  const shown = settled ? (q.answer?.type === "value" ? selectedIds(spec, q.answer.value) : []) : selectedIds(spec, value);

  const pick = (id: string) => {
    setError(undefined);
    setOther(undefined);
    if (spec.kind === "boolean") setValue(id === "true");
    else if (multi) setValue((v) => (Array.isArray(v) ? (v.includes(id) ? v.filter((x) => x !== id) : [...v, id]) : [id]));
    else setValue(id);
  };

  const send = async (answer: QuestionAnswer) => {
    const checked = validateAnswer(spec, answer);
    if (!checked.ok) return setError(checked.error);
    setError(undefined);
    const el = root.current;
    if (await ui.answer(q, checked.answer)) requestAnimationFrame(() => focusNextQuestion(el));
  };
  const confirm = () => {
    if (other !== undefined) return void send({ type: "other", text: other });
    if (value === undefined) return setError(spec.kind === "boolean" ? "Pick yes or no" : "Pick one of the options");
    void send({ type: "value", value });
  };

  // Native listeners: the block sits inside the editor, which would otherwise read these keys itself.
  const keys = useRef({ pick, confirm, send, choices, settled });
  keys.current = { pick, confirm, send, choices, settled };
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      const k = keys.current;
      if (k.settled || e.metaKey || e.ctrlKey || e.altKey) return;
      const typing = e.target instanceof HTMLElement && (e.target.tagName === "TEXTAREA" || (e.target instanceof HTMLInputElement && e.target.type !== "range"));
      if (e.key === "Enter" && !e.shiftKey && !(e.target instanceof HTMLButtonElement && e.target.dataset.action)) {
        e.preventDefault();
        e.stopPropagation();
        return k.confirm();
      }
      if (e.key === "Tab" && !e.shiftKey && !typing) {
        const open = [...document.querySelectorAll<HTMLElement>('[data-question-open="true"]')];
        const next = open[open.indexOf(el) + 1];
        if (next) {
          e.preventDefault();
          e.stopPropagation();
          next.focus({ preventScroll: true });
          next.scrollIntoView({ block: "nearest", behavior: "smooth" });
        }
        return;
      }
      if (typing) return void e.stopPropagation();
      const n = Number(e.key);
      if (n >= 1 && n <= k.choices.length) {
        e.preventDefault();
        k.pick(k.choices[n - 1]!.id);
      } else if (e.key.toLowerCase() === "s") {
        e.preventDefault();
        void k.send({ type: "skipped" });
      }
      e.stopPropagation();
    };
    // A press on the block must not reach the editor: it would select the block's node and redraw
    // it before the click lands, so the button under the pointer never hears it.
    const keep = (e: Event) => e.stopPropagation();
    el.addEventListener("keydown", onKey);
    el.addEventListener("mousedown", keep);
    el.addEventListener("pointerdown", keep);
    return () => {
      el.removeEventListener("keydown", onKey);
      el.removeEventListener("mousedown", keep);
      el.removeEventListener("pointerdown", keep);
    };
    // The block has no element while it is collapsed in a stepper.
  }, [display]);

  if (display === "collapsed")
    return (
      <div className="flex items-center gap-2.5 py-1 text-sm text-muted-foreground" data-question-collapsed>
        <FragmentGlyph type="question" className="size-4 opacity-50" />
        <span className="tabular-nums">
          {q.batch.index + 1} of {q.batch.total}
        </span>
        <span className="truncate">{spec.title}</span>
        <span className="ml-auto text-xs">Up next</span>
      </div>
    );

  const type = q.status === "answered" ? "decision" : q.status === "delegated" ? "assumption" : "question";
  const who = q.answeredBy ? (q.answeredBy === ui.me.user ? "you" : ui.nameOf(q.answeredBy)) : "";
  const freeAnswer = settled && q.answer && (q.answer.type === "other" || !choices.length);
  const reopenLabel = q.status === "skipped" ? "Answer" : q.status === "delegated" ? "Decide yourself" : "Change answer";

  return (
    <motion.div
      ref={root}
      layout
      tabIndex={settled ? -1 : 0}
      role="group"
      aria-label={spec.title}
      data-question-open={!settled}
      data-question={q.id}
      initial={ui.live ? { opacity: 0, y: 6 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      className={cn("ctx-question", settled ? "ctx-question-settled" : "ctx-question-open")}
    >
      <motion.div layout="position" className="flex items-start gap-2.5">
        <span className="flex size-6 shrink-0 items-center justify-center">
          <FragmentGlyph type={q.status === "skipped" ? "question" : type} className={cn("size-4", q.status === "skipped" && "opacity-40")} />
        </span>
        <div className="min-w-0 flex-1">
          <div className={cn("text-[15px] leading-6 font-medium text-foreground", settled && "font-normal text-muted-foreground")}>{spec.title}</div>
          {!settled && spec.detail && <div className="text-[13px] leading-snug text-muted-foreground">{spec.detail}</div>}
        </div>
        {!settled && q.batch.total > 1 && (
          <div className="flex shrink-0 flex-col items-end gap-1 pt-1">
            <span className="text-xs text-muted-foreground tabular-nums">
              {q.batch.index + 1} of {q.batch.total}
            </span>
            {stepper && (
              <span className="h-1 w-14 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done}>
                <span className="block h-full origin-left rounded-full bg-foreground/70 transition-transform duration-200" style={{ transform: `scaleX(${progress.total ? progress.done / progress.total : 0})` }} />
              </span>
            )}
          </div>
        )}
      </motion.div>

      {q.status !== "skipped" && (
        <div className={cn("pl-8.5", settled ? "mt-0.5" : "mt-2.5")}>
          {choices.length > 0 && !(settled && shown.length === 0) && (
            <div
              role={multi ? "group" : "radiogroup"}
              aria-label={spec.title}
              className={cn(
                settled ? "flex flex-wrap gap-x-4 gap-y-1" : multi ? "flex flex-wrap gap-2" : spec.kind === "sketch" ? "grid grid-cols-2 gap-2 sm:grid-cols-4" : spec.kind === "boolean" ? "grid grid-cols-2 gap-2" : "flex flex-col gap-1.5",
              )}
            >
              <AnimatePresence initial={false} mode="popLayout">
                {choices
                  .map((c, i) => ({ c, i }))
                  .filter(({ c }) => !settled || shown.includes(c.id))
                  .map(({ c, i }) => (
                    <OptionCard key={c.id} choice={c} index={i} selected={shown.includes(c.id)} settled={settled} multi={multi} onPick={() => pick(c.id)} />
                  ))}
              </AnimatePresence>
            </div>
          )}
          {!settled && spec.kind === "scale" && <Scale spec={spec} value={typeof value === "number" ? value : spec.min} onChange={setValue} />}
          {!settled && spec.kind === "rank" && <Rank choices={spec.options} order={Array.isArray(value) ? value : spec.options.map((o) => o.id)} onChange={setValue} />}
          {!settled &&
            spec.kind === "text" &&
            (spec.multiline ? (
              <textarea aria-label={spec.title} rows={3} value={typeof value === "string" ? value : ""} placeholder={spec.placeholder} onChange={(e) => setValue(e.target.value)} className="ctx-input min-h-20 resize-y py-2" />
            ) : (
              <input aria-label={spec.title} value={typeof value === "string" ? value : ""} placeholder={spec.placeholder} onChange={(e) => setValue(e.target.value)} className="ctx-input h-9" />
            ))}
          {freeAnswer && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }} className="text-[15px] leading-6 font-medium text-foreground">
              {answerText(spec, q.answer!)}
            </motion.div>
          )}

          <AnimatePresence initial={false}>
            {!settled && other !== undefined && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.18, ease: "easeOut" }} className="overflow-hidden">
                <input ref={otherInput} aria-label="Something else" value={other} placeholder="Say it in your own words" onChange={(e) => setOther(e.target.value)} className="ctx-input mt-2 h-9" />
              </motion.div>
            )}
          </AnimatePresence>

          {!settled && (
            <div className="mt-3 flex flex-wrap items-center gap-1">
              {spec.kind !== "text" && (
                <Button
                  size="xs"
                  variant={other !== undefined ? "secondary" : "ghost"}
                  data-action="other"
                  onClick={() => {
                    setOther((o) => (o === undefined ? "" : undefined));
                    requestAnimationFrame(() => otherInput.current?.focus());
                  }}
                >
                  Something else
                </Button>
              )}
              <Tooltip>
                <TooltipTrigger render={<Button size="xs" variant="ghost" data-action="delegate" onClick={() => void send({ type: "delegated" })} />}>You decide</TooltipTrigger>
                <TooltipContent>The agent assumes an answer and marks it as an assumption anyone can overturn</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger render={<Button size="xs" variant="ghost" data-action="skip" onClick={() => void send({ type: "skipped" })} />}>Skip</TooltipTrigger>
                <TooltipContent>
                  Leave it unanswered <Kbd>S</Kbd>
                </TooltipContent>
              </Tooltip>
              <span className="ml-auto flex items-center gap-2">
                {error && (
                  <span role="alert" className="text-xs text-destructive">
                    {error}
                  </span>
                )}
                <Button size="sm" data-action="confirm" onClick={confirm} className="gap-1.5">
                  {ui.canEdit ? "Confirm" : "Propose"}
                  <CornerDownLeft className="size-3.5 opacity-70" />
                </Button>
              </span>
            </div>
          )}
          {!settled && (pending || !ui.canEdit) && (
            <p className="mt-2 text-xs text-muted-foreground">{pending ? `Waiting for an editor: ${pending.summary}` : "You are a viewer: your answer goes to an editor as a proposal."}</p>
          )}
        </div>
      )}

      {settled && (
        <motion.div layout="position" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2, delay: 0.1 }} className="mt-1 flex flex-wrap items-center gap-x-2 pl-8.5 text-xs text-muted-foreground">
          <span>
            {q.status === "skipped" ? "Skipped" : q.status === "delegated" ? "Assumed by the agent" : "Decided"}
            {who ? `${q.status === "delegated" ? ", asked by" : " by"} ${who}` : ""}
            {q.answeredAt ? ` · ${ago(q.answeredAt)}` : ""}
          </span>
          {/* No tooltip for an editor: on a link this small its arrow sits over the link and takes the click. */}
          {ui.canEdit ? (
            <button type="button" onClick={() => void ui.reopen(q)} className="inline-flex items-center gap-1 rounded-sm font-medium text-foreground/80 underline-offset-2 transition-colors hover:text-foreground hover:underline">
              <Undo2 className="size-3" />
              {reopenLabel}
            </button>
          ) : (
            <Tooltip>
              <TooltipTrigger render={<button type="button" aria-disabled className="inline-flex cursor-not-allowed items-center gap-1 rounded-sm font-medium text-foreground/80 opacity-50" />}>
                <Undo2 className="size-3" />
                {reopenLabel}
              </TooltipTrigger>
              <TooltipContent>{VIEWER_NOTE}</TooltipContent>
            </Tooltip>
          )}
        </motion.div>
      )}
    </motion.div>
  );
}
