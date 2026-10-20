import { Bot, Calendar, Check, CircleDashed, Cloud, Code, FileText, Gauge, Globe, Hammer, Repeat, ShieldCheck, Square, SquareTerminal, Terminal, Triangle, Webhook, Workflow, type LucideIcon, MessagesSquare, GitBranch, Plug } from "lucide-react";
import { AzureDevOpsIcon, GitHubIcon, GitLabIcon, JiraIcon, LinearIcon, SlackIcon, TeamsIcon } from "@/components/kiln/brand-icons";
import type { RunStatus } from "@/lib/run-tree";
import { cn } from "@/lib/utils";

type IconC = React.ComponentType<{ className?: string }>;

const SOURCE_ICON: Record<string, IconC> = {
  linear: LinearIcon,
  slack: SlackIcon,
  teams: TeamsIcon,
  api: Code,
  mcp: Plug,
  local: SquareTerminal,
  schedule: Calendar,
  scheduled: Calendar,
  kiln: Globe,
  web: Globe,
  github_action: GitHubIcon,
  github: GitHubIcon,
  gitlab: GitLabIcon,
  azure_devops: AzureDevOpsIcon,
  cloud: Cloud,
  cli: Terminal,
  jira: JiraIcon,
  scorer: Gauge,
  benchmark: Gauge,
  improver: Hammer,
  self_improvement: Hammer,
  orchestration: Workflow,
  webhook: Webhook,
  replay: Repeat,
};

export function SourceIcon({ source, className }: { source: string; className?: string }) {
  const I = SOURCE_ICON[source] ?? Globe;
  return <I className={cn("size-3.5", className)} />;
}

const STATUS_SQUARE: Record<RunStatus, string> = {
  complete: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  running: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
  failed: "bg-pink-500/10 text-pink-600 dark:text-pink-400",
  blocked: "bg-orange-500/10 text-orange-600 dark:text-orange-400",
  cancelled: "bg-slate-500/10 text-slate-500 dark:text-slate-400",
};

/** The glyph used for a run status in squares, menus and filters. */
export function StatusGlyph({ status, className }: { status: RunStatus; className?: string }) {
  const c = cn("size-3.5", className);
  if (status === "complete") return <Check className={cn(c, "stroke-[2.5]")} />;
  if (status === "running")
    return (
      <svg viewBox="0 0 16 16" className={cn(c, "text-violet-600 dark:text-violet-400")} aria-hidden>
        <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M8 3.5A4.5 4.5 0 0 1 8 12.5Z" fill="currentColor" />
      </svg>
    );
  if (status === "failed") return <Triangle className={cn(c, "fill-current text-pink-600 dark:text-pink-400")} />;
  if (status === "blocked") return <Square className={cn(c, "fill-current text-orange-600 dark:text-orange-400")} />;
  return <Square className={cn(c, "fill-current text-slate-500")} />;
}

export function StatusSquare({ status, size = 24, className }: { status: RunStatus; size?: number; className?: string }) {
  return (
    <span className={cn("inline-flex shrink-0 items-center justify-center rounded-[5px]", STATUS_SQUARE[status], className)} style={{ width: size, height: size }} aria-label={status}>
      <StatusGlyph status={status} className={size < 22 ? "size-3" : "size-4"} />
    </span>
  );
}

type AgentLook = { icon: LucideIcon; tone: string; bar: string };
const AGENT_LOOK: Record<string, AgentLook> = {
  foreman: { icon: GitBranch, tone: "bg-violet-500/10 text-violet-600 dark:text-violet-400", bar: "bg-violet-500/15 border-violet-500" },
  triage: { icon: CircleDashed, tone: "bg-muted text-muted-foreground", bar: "bg-muted border-muted-foreground/50" },
  implement: { icon: Code, tone: "bg-blue-500/10 text-blue-600 dark:text-blue-400", bar: "bg-blue-500/15 border-blue-500" },
  code: { icon: Code, tone: "bg-blue-500/10 text-blue-600 dark:text-blue-400", bar: "bg-blue-500/15 border-blue-500" },
  review: { icon: MessagesSquare, tone: "bg-pink-500/10 text-pink-600 dark:text-pink-400", bar: "bg-pink-500/15 border-pink-500" },
  spec: { icon: FileText, tone: "bg-amber-500/10 text-amber-600 dark:text-amber-400", bar: "bg-amber-500/15 border-amber-500" },
  verify: { icon: ShieldCheck, tone: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400", bar: "bg-emerald-500/15 border-emerald-500" },
};
const DEFAULT_LOOK: AgentLook = { icon: Bot, tone: "bg-muted text-muted-foreground", bar: "bg-muted border-muted-foreground/50" };

export function agentLook(agent: string): AgentLook {
  return AGENT_LOOK[agent.toLowerCase()] ?? DEFAULT_LOOK;
}

export function AgentIcon({ agent, size = 16, className }: { agent: string; size?: number; className?: string }) {
  const look = agentLook(agent);
  const I = look.icon;
  return (
    <span className={cn("inline-flex shrink-0 items-center justify-center rounded-[4px]", look.tone, className)} style={{ width: size, height: size }}>
      <I className={size <= 16 ? "size-3" : "size-3.5"} />
    </span>
  );
}

/** Small rounded chip used in run rows and metadata ("PR Created", "Kiln Web", "1 Image"). */
export function Chip({ children, className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span className={cn("inline-flex h-[22px] shrink-0 items-center gap-1 overflow-hidden rounded-full border bg-background px-2 text-xs font-medium whitespace-nowrap text-foreground/80", className)} {...props}>
      {children}
    </span>
  );
}

/** Initials avatar for people; the API carries no profile photos. */
export function PersonAvatar({ name, size = 24, className }: { name: string; size?: number; className?: string }) {
  const clean = name.split("@")[0] ?? name;
  const letters = clean
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
  return (
    <span className={cn("inline-flex shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground ring-1 ring-border", className)} style={{ width: size, height: size }} title={name}>
      {letters || "?"}
    </span>
  );
}

export function personName(subject: string): string {
  const base = subject.split("@")[0] ?? subject;
  return base
    .split(/[._-]+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}
