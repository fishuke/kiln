"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  BookOpen,
  Building2,
  ChevronDown,
  ChevronRight,
  Contrast,
  CreditCard,
  Ellipsis,

  Inbox,
  KeyRound,
  LayoutGrid,
  Link2,
  List,
  LogOut,
  MessageCirclePlus,
  PanelLeft,
  Pin,
  Plus,
  Search,
  Settings,
  Archive,
  Workflow,
  Boxes,
  Puzzle,
  ScrollText,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { GitHubIcon, LinearIcon } from "./brand-icons";
import { useTheme, type ThemePreference } from "./theme";

export type ShellFactory = { id: string; name: string; alias: string; canary?: unknown };
export type ShellUser = { name: string; email: string; avatarUrl?: string; role?: string };
export type ShellTeam = { id: string; name: string };

const FACTORY_NAV = [
  ["Dashboard", "/dashboard"],
  ["Agents", "/agents"],
  ["Automations", "/automations"],
  ["Scorers", "/scorers"],
  ["Self-improvement", "/self-improvement"],
  ["Benchmarks", "/benchmarks"],
  ["Factory definition", "/definition"],
  ["Settings", "/settings"],
] as const;

export function FactoryAvatar({ name, className }: { name: string; className?: string }) {
  return <span className={cn("flex size-4 shrink-0 items-center justify-center rounded-[4px] bg-[#1d3b2a] text-[9px] font-semibold text-white uppercase", className)}>{name.slice(0, 1)}</span>;
}

function Item({ href, icon: Icon, label, badge, exact }: { href: string; icon: React.ComponentType<{ className?: string }>; label: string; badge?: number; exact?: boolean }) {
  const path = usePathname();
  const active = exact ? path === href || (href === "/runs/new" && path === "/") : path === href || path.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      className={cn(
        "flex h-9 items-center gap-2 rounded-lg pl-3 pr-2 text-sm text-foreground/90 transition-colors hover:bg-black/5 dark:hover:bg-white/5",
        active && "bg-black/10 font-medium text-foreground hover:bg-black/10 dark:bg-white/10 dark:hover:bg-white/10",
      )}
    >
      <Icon className="size-4 shrink-0" />
      <span className="truncate">{label}</span>
      {badge ? <span className="ml-auto rounded-full bg-foreground/10 px-1.5 text-[11px] font-medium tabular-nums">{badge}</span> : null}
    </Link>
  );
}

function SubItem({ href, label }: { href: string; label: string }) {
  const path = usePathname();
  const active = path === href || path.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      className={cn(
        "flex h-9 items-center rounded-lg pl-6 text-sm text-foreground/90 transition-colors hover:bg-black/5 dark:hover:bg-white/5",
        active && "bg-black/10 font-medium text-foreground dark:bg-white/10",
      )}
    >
      {label}
    </Link>
  );
}

function copy(text: string) {
  void navigator.clipboard?.writeText(text);
}

function FactoryRow({ f, pinned, onPin }: { f: ShellFactory; pinned: boolean; onPin: () => void }) {
  const path = usePathname();
  const [open, setOpen] = useState(true);
  const base = `/f/${f.id}`;
  useEffect(() => {
    if (path.startsWith(base)) setOpen(true);
  }, [path, base]);
  return (
    <div>
      <div className="group flex h-8 items-center gap-2 rounded-lg pl-3 pr-1 hover:bg-black/5 dark:hover:bg-white/5">
        <FactoryAvatar name={f.name} />
        <Link href={`${base}/dashboard`} className="min-w-0 flex-1 truncate text-sm font-semibold">
          {f.name}
        </Link>
        <DropdownMenu>
          <DropdownMenuTrigger aria-label={`More options for ${f.name}`} className="hidden size-6 items-center justify-center rounded-md text-muted-foreground group-hover:flex hover:bg-black/5 data-popup-open:flex dark:hover:bg-white/10">
            <Ellipsis className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-62" align="start">
            <DropdownMenuItem onClick={() => copy(`${location.origin}${base}/dashboard`)}>
              <Link2 /> Copy link to factory
            </DropdownMenuItem>
            <DropdownMenuItem render={<Link href={`${base}/definition?import=1`} />}>
              <Archive /> Import
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Copy factory handle or label</DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-66">
                <DropdownMenuItem onClick={() => copy(`@${f.alias}`)}>
                  <LinearIcon /> Copy factory handle for Linear
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => copy("@kiln-factory")}>
                  <GitHubIcon /> Copy factory handle for GitHub
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => copy(`factory:${f.alias}`)}>
                  <GitHubIcon /> Copy factory label for GitHub
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </DropdownMenuContent>
        </DropdownMenu>
        <button
          type="button"
          aria-label={`${pinned ? "Unpin" : "Pin"} ${f.name}`}
          onClick={onPin}
          className={cn("size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-black/5 dark:hover:bg-white/10", pinned ? "flex" : "hidden group-hover:flex")}
        >
          <Pin className={cn("size-3.5", pinned && "fill-current")} />
        </button>
        <button type="button" aria-label={open ? "Collapse" : "Expand"} onClick={() => setOpen(!open)} className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-black/5 dark:hover:bg-white/10">
          {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        </button>
      </div>
      {open && (
        <div className="mt-0.5 space-y-0.5 pl-2">
          {FACTORY_NAV.map(([label, suffix]) => (
            <SubItem key={label} href={`${base}${suffix}`} label={label} />
          ))}
        </div>
      )}
    </div>
  );
}

function AccountMenu({ user, team, teams }: { user?: ShellUser; team?: ShellTeam; teams: ShellTeam[] }) {
  const [pref, setPref] = useTheme();
  const name = user?.name ?? "You";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex h-[54px] w-full items-center gap-3 rounded-lg px-2 text-left hover:bg-black/5 dark:hover:bg-white/5">
        {user?.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={user.avatarUrl} alt="" className="size-8 rounded-full object-cover" />
        ) : (
          <span className="flex size-8 items-center justify-center rounded-full bg-foreground/10 text-sm font-medium">{name.slice(0, 1).toUpperCase()}</span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{name}</span>
          <span className="block truncate text-xs text-muted-foreground">{team?.name ?? "Local"}</span>
        </span>
        <ChevronDown className="size-4 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-62">
        <div className="px-2 py-1.5">
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-sm font-medium">{name}</span>
            {user?.role && <span className="rounded-md border px-1.5 text-xs capitalize">{user.role}</span>}
          </div>
          <div className="truncate text-sm text-muted-foreground">{user?.email}</div>
        </div>
        <DropdownMenuSeparator />
        {teams.length > 1 ? (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <span className="flex size-4 items-center justify-center rounded-[3px] border text-[8px] font-semibold">{team?.name.slice(0, 1)}</span>
              {team?.name}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {teams.map((t) => (
                <DropdownMenuItem key={t.id} render={<Link href={`/teams/switch?team=${t.id}`} />}>
                  {t.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ) : (
          <DropdownMenuItem disabled>
            <span className="flex size-4 items-center justify-center rounded-[3px] border text-[8px] font-semibold">{(team?.name ?? "L").slice(0, 1)}</span>
            {team?.name ?? "Local"}
          </DropdownMenuItem>
        )}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Contrast /> Appearance
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuRadioGroup value={pref} onValueChange={(v) => setPref(v as ThemePreference)}>
              <DropdownMenuRadioItem value="light">Light</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="dark">Dark</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="system">System preference</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuItem render={<Link href="/settings/usage" />}>
          <CreditCard /> Usage and limits
        </DropdownMenuItem>
        <DropdownMenuItem render={<Link href="/settings" />}>
          <Settings /> Settings
        </DropdownMenuItem>
        <DropdownMenuItem render={<Link href="/team" />}>
          <Building2 /> Team settings
        </DropdownMenuItem>
        <DropdownMenuItem render={<Link href="/docs" />}>
          <BookOpen /> Docs
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem render={<a href="/logout" />}>
          <LogOut /> Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const WIDTH_KEY = "kiln-sidebar-width";
const PIN_KEY = "kiln-pinned-factories";

export function Sidebar({
  factories,
  inboxCount,
  user,
  team,
  teams = [],
  usage,
}: {
  factories: ShellFactory[];
  inboxCount: number;
  user?: ShellUser;
  team?: ShellTeam;
  teams?: ShellTeam[];
  usage?: { label: string; tone: "ok" | "warn" | "over" };
}) {
  const [width, setWidth] = useState(240);
  const [collapsed, setCollapsed] = useState(false);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const [pinned, setPinned] = useState<string[]>([]);
  const dragging = useRef(false);

  useEffect(() => {
    try {
      setWidth(Number(localStorage.getItem(WIDTH_KEY)) || 240);
      setPinned(JSON.parse(localStorage.getItem(PIN_KEY) ?? "[]"));
      setCollapsed(localStorage.getItem("kiln-sidebar-collapsed") === "1");
    } catch {
      /* storage blocked */
    }
  }, []);

  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (!dragging.current) return;
      setWidth(Math.min(480, Math.max(200, e.clientX)));
    };
    const up = () => {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.userSelect = "";
      setWidth((w) => {
        try {
          localStorage.setItem(WIDTH_KEY, String(w));
        } catch {
          /* storage blocked */
        }
        return w;
      });
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, []);

  const toggleCollapsed = (v: boolean) => {
    setCollapsed(v);
    try {
      localStorage.setItem("kiln-sidebar-collapsed", v ? "1" : "0");
    } catch {
      /* storage blocked */
    }
  };
  const togglePin = (id: string) => {
    const next = pinned.includes(id) ? pinned.filter((p) => p !== id) : [...pinned, id];
    setPinned(next);
    try {
      localStorage.setItem(PIN_KEY, JSON.stringify(next));
    } catch {
      /* storage blocked */
    }
  };

  if (collapsed) {
    return (
      <aside className="sticky top-0 flex h-screen w-14 shrink-0 flex-col items-center gap-1 border-r bg-sidebar py-3">
        <button type="button" aria-label="Expand sidebar" onClick={() => toggleCollapsed(false)} className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-black/5 dark:hover:bg-white/10">
          <PanelLeft className="size-4" />
        </button>
        {[
          ["/runs/new", MessageCirclePlus, "New Chat"],
          ["/inbox", Inbox, "Inbox"],
          ["/runs", List, "Runs"],
        ].map(([href, Icon, label]) => {
          const I = Icon as typeof Inbox;
          return (
            <Link key={href as string} href={href as string} aria-label={label as string} className="flex size-9 items-center justify-center rounded-lg hover:bg-black/5 dark:hover:bg-white/10">
              <I className="size-4" />
            </Link>
          );
        })}
      </aside>
    );
  }

  const q = query.trim().toLowerCase();
  const shown = factories
    .filter((f) => !q || f.name.toLowerCase().includes(q) || f.alias.toLowerCase().includes(q))
    .sort((a, b) => Number(pinned.includes(b.id)) - Number(pinned.includes(a.id)));

  return (
    <aside style={{ width }} className="sticky top-0 flex h-screen shrink-0 flex-col border-r bg-sidebar">
      <div className="flex h-14 items-center gap-1 px-3">
        {searching ? (
          <div className="flex h-9 flex-1 items-center gap-2 rounded-lg border-2 border-foreground bg-background px-2">
            <Search className="size-4 text-muted-foreground" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setSearching(false);
                  setQuery("");
                }
              }}
              onBlur={() => !query && setSearching(false)}
              placeholder="Search factories..."
              className="min-w-0 flex-1 bg-transparent text-sm outline-none"
            />
          </div>
        ) : (
          <>
            <Link href="/runs/new" aria-label="Kiln home" className="flex size-7 items-center justify-center rounded-md bg-foreground text-background">
              <svg viewBox="0 0 16 16" className="size-4" fill="currentColor" aria-hidden>
                <path d="M3 13.5 6.2 2.5h2.6L5.6 13.5zM7.4 13.5l3.2-11h2.6l-3.2 11z" />
              </svg>
            </Link>
            <span className="flex-1" />
            <button type="button" aria-label="Search factories" onClick={() => setSearching(true)} className="flex size-8 items-center justify-center rounded text-muted-foreground hover:bg-black/5 dark:hover:bg-white/10">
              <Search className="size-4" />
            </button>
          </>
        )}
        <button type="button" aria-label="Collapse sidebar" onClick={() => toggleCollapsed(true)} className="flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-black/5 dark:hover:bg-white/10">
          <PanelLeft className="size-4" />
        </button>
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 pb-4">
        <Item href="/runs/new" icon={MessageCirclePlus} label="New Chat" exact />
        <Item href="/inbox" icon={Inbox} label="Inbox" badge={inboxCount} />
        <Item href="/runs" icon={List} label="Runs" exact />
        <Item href="/mcps" icon={LayoutGrid} label="MCPs and apps" />
        <Item href="/secrets" icon={KeyRound} label="Secrets" />
        <Item href="/integrations" icon={Workflow} label="Integrations" />
        <Item href="/environments" icon={Boxes} label="Environments" />
        <Item href="/skills" icon={Puzzle} label="Skills" />
        <Item href="/audit" icon={ScrollText} label="Audit log" />

        <div className="flex h-9 items-center justify-between pt-3 pl-3 pr-1 text-xs font-medium text-muted-foreground">
          Factories
          <Link href="/create" aria-label="Create factory" className="flex size-6 items-center justify-center rounded-md hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10">
            <Plus className="size-4" />
          </Link>
        </div>
        {shown.map((f) => (
          <FactoryRow key={f.id} f={f} pinned={pinned.includes(f.id)} onPin={() => togglePin(f.id)} />
        ))}
        {factories.length === 0 && (
          <Link href="/create" className="flex h-9 items-center gap-2 rounded-lg pl-3 text-sm text-muted-foreground hover:bg-black/5 dark:hover:bg-white/5">
            <Plus className="size-4" /> Create your first factory
          </Link>
        )}
      </nav>

      <div className="border-t px-3 py-2">
        {usage && (
          <Link href="/settings/usage" className="flex h-8 items-center gap-2 px-1 text-sm text-foreground/80 hover:text-foreground">
            <span className={cn("size-2 rounded-full", usage.tone === "ok" ? "bg-blue-500" : usage.tone === "warn" ? "bg-amber-500" : "bg-red-500")} />
            {usage.label}
          </Link>
        )}
        <AccountMenu user={user} team={team} teams={teams} />
      </div>
      <div
        role="separator"
        aria-label="Resize sidebar"
        aria-orientation="vertical"
        onMouseDown={() => {
          dragging.current = true;
          document.body.style.userSelect = "none";
        }}
        className="absolute top-0 right-0 h-full w-1 translate-x-1/2 cursor-col-resize hover:bg-foreground/10"
      />
    </aside>
  );
}
