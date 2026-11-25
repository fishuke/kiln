import { CircleCheckBig, CircleDashed, CircleQuestionMark, Gauge, Heading2, Image as ImageIcon, Ruler, SquareCheck, Text, TriangleAlert, Workflow, type LucideIcon } from "lucide-react";
import type { FragmentType } from "@/lib/studio/types";

/**
 * One glyph and one colour per fragment type, used everywhere the type appears: the block's mark,
 * the slash menu, the Brief, the freshness list. `tone` sets `--tone`, which the mark and the tint read.
 */
export const FRAGMENT_META: Record<FragmentType, { label: string; hint: string; icon: LucideIcon; tone: string }> = {
  text: { label: "Text", hint: "Plain writing", icon: Text, tone: "text-muted-foreground" },
  section: { label: "Section", hint: "A heading", icon: Heading2, tone: "text-muted-foreground" },
  requirement: { label: "Requirement", hint: "Something the product must do", icon: SquareCheck, tone: "text-blue-600 dark:text-blue-400" },
  decision: { label: "Decision", hint: "A choice that was made, and by whom", icon: CircleCheckBig, tone: "text-emerald-600 dark:text-emerald-400" },
  assumption: { label: "Assumption", hint: "Assumed until someone decides", icon: CircleDashed, tone: "text-amber-600 dark:text-amber-400" },
  constraint: { label: "Constraint", hint: "A limit the build must respect", icon: Ruler, tone: "text-zinc-600 dark:text-zinc-300" },
  question: { label: "Question", hint: "Waiting for an answer", icon: CircleQuestionMark, tone: "text-orange-600 dark:text-orange-400" },
  flow: { label: "Flow", hint: "Steps a person takes", icon: Workflow, tone: "text-teal-600 dark:text-teal-400" },
  risk: { label: "Risk", hint: "What could go wrong", icon: TriangleAlert, tone: "text-rose-600 dark:text-rose-400" },
  metric: { label: "Metric", hint: "How success is measured", icon: Gauge, tone: "text-sky-600 dark:text-sky-400" },
  image: { label: "Image", hint: "A picture", icon: ImageIcon, tone: "text-muted-foreground" },
};

/** The fragment's glyph in its colour. */
export function FragmentGlyph({ type, className }: { type: FragmentType; className?: string }) {
  const m = FRAGMENT_META[type];
  const Icon = m.icon;
  return <Icon aria-hidden className={`${m.tone} ${className ?? "size-4"}`} />;
}
