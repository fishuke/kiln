import { Bot, CircleDashed, CodeXml, FileCode, Map, MessagesSquare, ShieldCheck, UserRound, Workflow, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** Per agent type: icon, tile background (*-100) and icon color (*-600); dark mode uses tinted tiles. */
const TYPES: Record<string, { icon: LucideIcon; tile: string; color: string }> = {
  FOREMAN: { icon: Workflow, tile: "bg-purple-100 dark:bg-purple-500/15", color: "text-purple-600 dark:text-purple-400" },
  IMPLEMENT: { icon: CodeXml, tile: "bg-blue-100 dark:bg-blue-500/15", color: "text-blue-600 dark:text-blue-400" },
  REVIEW: { icon: MessagesSquare, tile: "bg-pink-100 dark:bg-pink-500/15", color: "text-pink-600 dark:text-pink-400" },
  SPEC: { icon: FileCode, tile: "bg-orange-100 dark:bg-orange-500/15", color: "text-orange-600 dark:text-orange-400" },
  TRIAGE: { icon: CircleDashed, tile: "bg-muted", color: "text-foreground" },
  VERIFY: { icon: ShieldCheck, tile: "bg-emerald-100 dark:bg-emerald-500/15", color: "text-emerald-600 dark:text-emerald-400" },
  PLAN: { icon: Map, tile: "bg-teal-100 dark:bg-teal-500/15", color: "text-teal-600 dark:text-teal-400" },
  PO_ASSISTANT: { icon: UserRound, tile: "bg-amber-100 dark:bg-amber-500/15", color: "text-amber-600 dark:text-amber-400" },
  CUSTOM: { icon: Bot, tile: "bg-muted", color: "text-muted-foreground" },
};

export function agentTypeStyle(type: string) {
  return TYPES[type] ?? TYPES.CUSTOM!;
}

/** The 40px icon tile on agent cards and the agent page; `size="sm"` is the inline 16px glyph for menus. */
export function AgentTypeIcon({ type, size = "lg", className }: { type: string; size?: "sm" | "lg"; className?: string }) {
  const t = agentTypeStyle(type);
  const Icon = t.icon;
  if (size === "sm") return <Icon className={cn("size-4", t.color, className)} />;
  return (
    <span className={cn("flex size-10 shrink-0 items-center justify-center rounded", t.tile, className)}>
      <Icon className={cn("size-7", t.color)} strokeWidth={1.75} />
    </span>
  );
}
