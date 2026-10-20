import Link from "next/link";
import { BookOpen, Boxes, Inbox, KeyRound, LayoutList, MessageSquarePlus, Plug, Plus, Puzzle, ScrollText, Search, Sparkles, Users } from "lucide-react";
import type { FactorySummary } from "@kiln/sdk-ts";
import { NavLink } from "./nav-link";

const FACTORY_NAV = [
  ["Dashboard", ""],
  ["Agents", "/agents"],
  ["Automations", "/automations"],
  ["Pipelines", "/pipelines"],
  ["Scorers", "/scorers"],
  ["Self-improvement", "/self-improvement"],
  ["Benchmarks", "/benchmarks"],
  ["Factory definition", "/definition"],
  ["Settings", "/settings"],
] as const;

function Avatar({ name }: { name: string }) {
  return <span className="flex size-5 shrink-0 items-center justify-center rounded bg-emerald-950 text-[10px] font-bold text-emerald-50 uppercase">{name.slice(0, 1)}</span>;
}

export function Sidebar({ factories, inboxCount, subject, mode }: { factories: FactorySummary[]; inboxCount: number; subject?: string; mode?: string }) {
  return (
    <aside className="sticky top-0 flex h-screen w-60 shrink-0 flex-col border-r bg-neutral-50 dark:bg-neutral-950">
      <div className="flex h-14 items-center justify-between px-4">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <span className="flex size-6 items-center justify-center rounded-md bg-foreground text-background">
            <Sparkles className="size-3.5" />
          </span>
          kiln
        </Link>
        <Link href="/runs" aria-label="Search runs" className="text-muted-foreground hover:text-foreground">
          <Search className="size-4" />
        </Link>
      </div>
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-4">
        <NavLink href="/" exact>
          <MessageSquarePlus className="size-4" /> New run
        </NavLink>
        <NavLink href="/inbox">
          <Inbox className="size-4" /> Inbox
          {inboxCount > 0 && <span className="ml-auto rounded-full bg-amber-500 px-1.5 text-[11px] font-semibold text-white">{inboxCount}</span>}
        </NavLink>
        <NavLink href="/runs">
          <LayoutList className="size-4" /> Runs
        </NavLink>
        <NavLink href="/projects">
          <Boxes className="size-4" /> Projects
        </NavLink>
        <NavLink href="/mcp">
          <Plug className="size-4" /> MCPs and apps
        </NavLink>
        <NavLink href="/skills">
          <Puzzle className="size-4" /> Skills
        </NavLink>
        <NavLink href="/secrets">
          <KeyRound className="size-4" /> Secrets
        </NavLink>
        <NavLink href="/integrations">
          <Plug className="size-4" /> Integrations
        </NavLink>
        <NavLink href="/users">
          <Users className="size-4" /> Users
        </NavLink>
        <NavLink href="/audit">
          <ScrollText className="size-4" /> Audit log
        </NavLink>
        <NavLink href="/docs">
          <BookOpen className="size-4" /> Docs
        </NavLink>

        <div className="flex items-center justify-between px-2.5 pt-5 pb-1 text-xs font-medium text-muted-foreground">
          Factories
          <Link href="/factories/new" aria-label="Create factory" className="hover:text-foreground">
            <Plus className="size-4" />
          </Link>
        </div>
        {factories.map((f) => (
          <details key={f.id} className="group" open={factories.length <= 2}>
            <summary className="flex cursor-pointer list-none items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm font-medium hover:bg-black/5 dark:hover:bg-white/5">
              <Avatar name={f.name} />
              <span className="truncate">{f.name}</span>
              {f.canary && <span className="ml-auto rounded bg-violet-100 px-1 text-[10px] text-violet-900">canary</span>}
            </summary>
            <div className="mt-0.5 ml-3 space-y-0.5 border-l pl-2">
              {FACTORY_NAV.map(([label, suffix]) => (
                <NavLink key={label} href={`/f/${f.id}${suffix}`} exact={suffix === ""} className="py-1">
                  {label}
                </NavLink>
              ))}
            </div>
          </details>
        ))}
        {factories.length === 0 && <p className="px-2.5 py-2 text-xs text-muted-foreground">No factories yet.</p>}
      </nav>
      <div className="border-t px-4 py-3 text-xs">
        <div className="flex items-center gap-2 text-muted-foreground">
          <span className={`size-2 rounded-full ${mode ? "bg-emerald-500" : "bg-neutral-400"}`} />
          {mode ? `Connected · ${mode}` : "API offline"}
        </div>
        {subject && <div className="mt-1 truncate font-medium">{subject}</div>}
      </div>
    </aside>
  );
}
