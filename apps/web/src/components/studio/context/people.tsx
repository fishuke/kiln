import { Sparkles } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { AgentStatus, Permission } from "@/lib/studio/types";
import { cn } from "@/lib/utils";

const COLORS = ["#2563eb", "#059669", "#d97706", "#db2777", "#7c3aed", "#0891b2", "#dc2626", "#4d7c0f"];

/** A person's colour in cursors and presence: the same everywhere, from who they are. */
export function memberColor(user: string): string {
  let h = 0;
  for (const c of user) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length]!;
}

export const PERMISSION_LABEL: Record<Permission, string> = { owner: "Owner", editor: "Editor", viewer: "Viewer" };

export type Present = { name: string; color: string };

/** Who has the Context open, and the agent while it works. */
export function Presence({ people, agent, className }: { people: Present[]; agent: AgentStatus; className?: string }) {
  const working = agent.state !== "idle" && agent.state !== "waiting";
  return (
    <div className={cn("flex items-center", className)} aria-label="Here now">
      {working && (
        <Tooltip>
          <TooltipTrigger render={<span className="mr-1.5 flex h-6 items-center gap-1 rounded-full border bg-background pr-2 pl-1.5 text-xs font-medium" />}>
            <Sparkles className="size-3 text-violet-600 dark:text-violet-400" />
            Agent
            <span className="ctx-pulse size-1.5 rounded-full bg-violet-500" />
          </TooltipTrigger>
          <TooltipContent>{agent.label || "Working"}</TooltipContent>
        </Tooltip>
      )}
      <div className="flex -space-x-1.5">
        {people.slice(0, 5).map((p) => (
          <Tooltip key={p.name}>
            <TooltipTrigger
              render={<span className="flex size-6 items-center justify-center rounded-full text-[10px] font-semibold text-white uppercase ring-2 ring-background" style={{ backgroundColor: p.color }} />}
            >
              {p.name.slice(0, 1)}
            </TooltipTrigger>
            <TooltipContent>{p.name}</TooltipContent>
          </Tooltip>
        ))}
        {people.length > 5 && <span className="flex size-6 items-center justify-center rounded-full bg-muted text-[10px] font-medium ring-2 ring-background">+{people.length - 5}</span>}
      </div>
    </div>
  );
}
