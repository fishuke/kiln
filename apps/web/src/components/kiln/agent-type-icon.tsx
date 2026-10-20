import { Bot, CodeXml, FileCode, GitFork, Loader, MessagesSquare, ShieldCheck, Workflow } from "lucide-react";
import { cn } from "@/lib/utils";

const ICONS: Record<string, { icon: typeof Bot; tone: string }> = {
  FOREMAN: { icon: Workflow, tone: "text-violet-600 dark:text-violet-400" },
  IMPLEMENT: { icon: CodeXml, tone: "text-blue-600 dark:text-blue-400" },
  REVIEW: { icon: MessagesSquare, tone: "text-pink-600 dark:text-pink-400" },
  SPEC: { icon: FileCode, tone: "text-orange-600 dark:text-orange-400" },
  TRIAGE: { icon: Loader, tone: "text-muted-foreground" },
  VERIFY: { icon: ShieldCheck, tone: "text-emerald-600 dark:text-emerald-400" },
  PLAN: { icon: GitFork, tone: "text-cyan-600 dark:text-cyan-400" },
};

/** Coloured icon per agent type, as in the agent pickers. */
export function AgentTypeIcon({ type, className }: { type?: string; className?: string }) {
  const { icon: Icon, tone } = ICONS[type ?? ""] ?? { icon: Bot, tone: "text-muted-foreground" };
  return <Icon className={cn("size-4 shrink-0", tone, className)} aria-hidden />;
}
