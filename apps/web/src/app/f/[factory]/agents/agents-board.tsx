"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ChevronDown, EllipsisVertical, ListFilter, MessageCirclePlus, Search, Trash, X } from "lucide-react";
import { toast } from "sonner";
import { AgentTypeIcon } from "@/components/kiln/agent-type-icon";
import { PageHeader } from "@/components/kiln/ui";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { deleteAgent } from "./actions";

export type AgentCard = { name: string; agentType: string; title: string; description: string };

const FILTERS = [
  { id: "all", label: "All agents", type: "" },
  { id: "foreman", label: "Foreman", type: "FOREMAN" },
  { id: "triage", label: "Triage", type: "TRIAGE" },
  { id: "spec", label: "Spec", type: "SPEC" },
  { id: "code", label: "Code", type: "IMPLEMENT" },
  { id: "review", label: "Review", type: "REVIEW" },
  { id: "custom", label: "Custom", type: "CUSTOM" },
];

/** The factory "New" menu: built-in agent types and a custom agent. */
export function NewAgentMenu({ factory }: { factory: string }) {
  const router = useRouter();
  const items = [
    { type: "TRIAGE", label: "Triage agent" },
    { type: "SPEC", label: "Spec agent" },
    { type: "IMPLEMENT", label: "Code agent" },
    { type: "REVIEW", label: "Review agent" },
  ];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button className="gap-1.5 px-3" />}>
        New <ChevronDown />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Factory agents</DropdownMenuLabel>
          {items.map((i) => (
            <DropdownMenuItem key={i.type} onClick={() => router.push(`/f/${factory}/agents/new?type=${i.type}`)}>
              <AgentTypeIcon type={i.type} size="sm" />
              {i.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => router.push(`/f/${factory}/agents/new`)}>
          <AgentTypeIcon type="CUSTOM" size="sm" />
          Custom agent
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function CardMenu({ factory, agent, readOnly }: { factory: string; agent: AgentCard; readOnly: boolean }) {
  const [confirm, setConfirm] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              aria-label="Open menu"
              className="relative z-10 flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={(e) => e.stopPropagation()}
            />
          }
        >
          <EllipsisVertical className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          <DropdownMenuItem variant="destructive" disabled={readOnly} onClick={() => setConfirm(true)}>
            <Trash />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {agent.title}?</AlertDialogTitle>
            <AlertDialogDescription>This removes agents/{agent.name}/ from the factory definition. Automations that target this agent stop working.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await deleteAgent(factory, agent.name);
                  if (!r.ok) toast.error(r.error);
                  else if (r.pullRequest) toast.success("Pull request opened", { action: { label: "View", onClick: () => window.open(r.pullRequest, "_blank") } });
                  else toast.success(`${agent.title} deleted`);
                  setConfirm(false);
                  router.refresh();
                })
              }
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function Card({ factory, agent, foreman, readOnly }: { factory: string; agent: AgentCard; foreman?: boolean; readOnly: boolean }) {
  const href = `/f/${factory}/agents/${agent.name}`;
  return (
    <div className="relative rounded border bg-background p-4 transition-colors hover:border-foreground/20">
      <Link href={href} aria-label={`Edit ${agent.title}`} className="absolute inset-0 z-0 rounded" />
      <div className="pointer-events-none relative flex items-start justify-between gap-3">
        <AgentTypeIcon type={agent.agentType} />
        <div className="pointer-events-auto">
          {foreman ? (
            <Button variant="outline" render={<Link href={`/runs/new?factory=${factory}`} />} nativeButton={false} className="relative z-10 h-8 gap-1.5">
              <MessageCirclePlus /> New chat
            </Button>
          ) : (
            <CardMenu factory={factory} agent={agent} readOnly={readOnly} />
          )}
        </div>
      </div>
      <h2 className="pointer-events-none relative mt-3 text-base font-semibold">{agent.title}</h2>
      <p className="pointer-events-none relative mt-1 text-sm text-muted-foreground">{agent.description || "No description."}</p>
    </div>
  );
}

export function AgentsBoard({ factory, factoryName, agents, readOnly }: { factory: string; factoryName: string; agents: AgentCard[]; readOnly: boolean }) {
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");
  const [searching, setSearching] = useState(false);
  const type = FILTERS.find((f) => f.id === filter)?.type ?? "";
  const match = (a: AgentCard) => (!type || a.agentType === type) && (!q || `${a.title} ${a.name} ${a.description}`.toLowerCase().includes(q.toLowerCase()));
  const foreman = agents.find((a) => a.agentType === "FOREMAN");
  const others = agents.filter((a) => a !== foreman && match(a));
  const showForeman = foreman && match(foreman);
  return (
    <>
      <PageHeader
        crumbs={[{ label: factoryName, href: `/f/${factory}/dashboard` }, { label: "Agents" }]}
        actions={
          <>
            {searching ? (
              <div className="relative">
                <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Escape" && (setQ(""), setSearching(false))} placeholder="Search agents" className="h-8 w-56 pr-8 pl-8" aria-label="Search agents" />
                <button type="button" aria-label="Clear search" className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground" onClick={() => (setQ(""), setSearching(false))}>
                  <X className="size-4" />
                </button>
              </div>
            ) : (
              <Button variant="outline" size="icon" aria-label="Search agents" onClick={() => setSearching(true)}>
                <Search />
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="outline" size="icon" aria-label={`Filter agents: ${FILTERS.find((f) => f.id === filter)!.label}`} className={cn(filter !== "all" && "border-foreground")} />}>
                <ListFilter />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuRadioGroup value={filter} onValueChange={(v) => setFilter(String(v))}>
                  {FILTERS.map((f) => (
                    <DropdownMenuRadioItem key={f.id} value={f.id}>
                      {f.type && <AgentTypeIcon type={f.type} size="sm" />}
                      {f.label}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            {!readOnly && <NewAgentMenu factory={factory} />}
          </>
        }
      />
      <div className="w-full px-6 py-8">
        {showForeman && (
          <div className="mx-auto max-w-[672px]">
            <Card factory={factory} agent={foreman} foreman readOnly={readOnly} />
          </div>
        )}
        {showForeman && others.length > 0 && <div className="mx-auto h-8 w-px bg-border" />}
        {others.length > 0 && (
          <div className="rounded border bg-muted/40 p-4">
            <div className="grid gap-4 md:grid-cols-2">
              {others.map((a) => (
                <Card key={a.name} factory={factory} agent={a} readOnly={readOnly} />
              ))}
            </div>
          </div>
        )}
        {!showForeman && others.length === 0 && <p className="py-16 text-center text-sm text-muted-foreground">{agents.length ? "No agents match this filter." : "This factory has no agents yet."}</p>}
      </div>
    </>
  );
}
