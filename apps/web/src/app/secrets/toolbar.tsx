"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Check, ChevronDown, Ellipsis, FileUp, KeyRound, ListFilter, Plus, Search, Trash2, UserRound, Users, X } from "lucide-react";
import { ConfirmAction } from "@/components/kiln/confirm-action";
import { useAction } from "@/components/kiln/use-action";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { parseDotenv, SECRET_TYPES } from "@/lib/secret-types";
import { cn } from "@/lib/utils";
import { deleteSecret, importSecrets } from "./actions";

function useParam() {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  return (key: string, value?: string) => {
    const next = new URLSearchParams(sp);
    if (value) next.set(key, value);
    else next.delete(key);
    router.replace(`${path}${next.size ? `?${next}` : ""}`);
  };
}

export function SecretsToolbar({ creators, canTeam }: { creators: string[]; canTeam: boolean }) {
  const sp = useSearchParams();
  const set = useParam();
  const [searching, setSearching] = useState(Boolean(sp.get("q")));
  const [importOpen, setImportOpen] = useState(false);
  const active = (k: string, v: string) => sp.get(k) === v;
  const item = (k: string, v: string, label: React.ReactNode) => (
    <DropdownMenuItem key={v} onClick={() => set(k, active(k, v) ? undefined : v)}>
      {label}
      {active(k, v) && <Check className="ml-auto text-violet-600" />}
    </DropdownMenuItem>
  );
  return (
    <>
      {searching ? (
        <div className="flex h-8 w-64 items-center gap-2 rounded-lg border-2 border-foreground bg-background px-2">
          <Search className="size-4 text-muted-foreground" />
          <input
            autoFocus
            defaultValue={sp.get("q") ?? ""}
            placeholder="Search secrets"
            onChange={(e) => set("q", e.target.value || undefined)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                set("q");
                setSearching(false);
              }
            }}
            className="min-w-0 flex-1 bg-transparent text-sm outline-none"
          />
          <button type="button" aria-label="Clear search" onClick={() => (set("q"), setSearching(false))} className="text-muted-foreground hover:text-foreground">
            <X className="size-3.5" />
          </button>
        </div>
      ) : (
        <Button variant="outline" size="icon" aria-label="Search secrets" onClick={() => setSearching(true)}>
          <Search className="text-muted-foreground" />
        </Button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="outline" size="icon" aria-label="Filter secrets" className={cn((sp.get("type") || sp.get("scope") || sp.get("creator")) && "border-foreground")} />}>
          <ListFilter className="text-muted-foreground" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-62">
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <KeyRound /> Type
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-64">{SECRET_TYPES.map((t) => item("type", t.id, t.label))}</DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Users /> Scope
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {item("scope", "team", "Team")}
              {item("scope", "personal", "Personal")}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <UserRound /> Creator
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-64">{creators.length ? creators.map((c) => item("creator", c, <span className="truncate">{c}</span>)) : <div className="px-2 py-1.5 text-sm text-muted-foreground">No options</div>}</DropdownMenuSubContent>
          </DropdownMenuSub>
          {(sp.get("type") || sp.get("scope") || sp.get("creator")) && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                render={<Link href={`/secrets${sp.get("q") ? `?q=${encodeURIComponent(sp.get("q")!)}` : ""}`} />}
              >
                <X /> Clear filters
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <NewSecretMenu onImport={() => setImportOpen(true)} />
      <ImportDialog open={importOpen} onOpenChange={setImportOpen} canTeam={canTeam} />
    </>
  );
}

export function NewSecretMenu({ onImport }: { onImport: () => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button aria-label="New secret" className="h-8 gap-1.5 px-3" />}>
        New <ChevronDown />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem render={<Link href="/secrets/new" />}>
          <Plus /> Create secret
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onImport}>
          <FileUp /> Import secrets
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function EmptyActions({ canTeam }: { canTeam: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Link href="/secrets/new" className={buttonVariants({ className: "h-8 px-3" })}>
        New secret
      </Link>
      <Button variant="outline" className="h-8 px-3" onClick={() => setOpen(true)}>
        Import secrets
      </Button>
      <ImportDialog open={open} onOpenChange={setOpen} canTeam={canTeam} />
    </>
  );
}

function ImportDialog({ open, onOpenChange, canTeam }: { open: boolean; onOpenChange: (o: boolean) => void; canTeam: boolean }) {
  const [text, setText] = useState("");
  const [scope, setScope] = useState<"team" | "personal">(canTeam ? "team" : "personal");
  const [pending, run] = useAction();
  const pairs = parseDotenv(text);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Import secrets</DialogTitle>
          <DialogDescription>Paste a .env file. Each KEY=value line becomes a raw secret; existing names get the new value.</DialogDescription>
        </DialogHeader>
        <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={"SENTRY_TOKEN=sntrys_…\nNPM_TOKEN=npm_…"} className="min-h-40 font-mono text-xs" spellCheck={false} />
        <label className="flex items-center gap-3 text-sm">
          <input
            type="file"
            accept=".env,text/plain"
            className="text-xs file:mr-2 file:rounded-md file:border file:bg-background file:px-2 file:py-1"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) setText(await f.text());
            }}
          />
        </label>
        <div className="flex gap-2 text-sm">
          {(["team", "personal"] as const).map((s) => (
            <button key={s} type="button" disabled={s === "team" && !canTeam} onClick={() => setScope(s)} className={cn("rounded-md border px-3 py-1 capitalize disabled:opacity-50", scope === s && "border-foreground bg-muted font-medium")}>
              {s}
            </button>
          ))}
          <span className="ml-auto self-center text-xs text-muted-foreground">
            {pairs.length} secret{pairs.length === 1 ? "" : "s"} found
          </span>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={pending || pairs.length === 0}
            onClick={() =>
              void run(() => importSecrets(scope, pairs), {
                onSuccess: () => {
                  setText("");
                  onOpenChange(false);
                },
              })
            }
          >
            {pending ? "Importing…" : `Import ${pairs.length || ""}`.trim()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function SecretRowMenu({ scope, name, canEdit }: { scope: "team" | "personal"; name: string; canEdit: boolean }) {
  const [confirm, setConfirm] = useState(false);
  if (!canEdit) return null;
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`Actions for ${name}`} />}>
          <Ellipsis />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem render={<Link href={`/secrets/${scope}/${encodeURIComponent(name)}`} />}>
            <KeyRound /> Edit
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={() => setConfirm(true)}>
            <Trash2 /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ConfirmAction open={confirm} onOpenChange={setConfirm} title={`Delete ${name}?`} description="Runs that list this secret will no longer get it. This cannot be undone." action={() => deleteSecret(scope, name)} />
    </>
  );
}
