"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { EllipsisVertical, Pause, Pencil, Play, Trash2 } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { triggerSummary } from "@/lib/automations/model";
import { localOffset } from "@/lib/automations/cron";
import { timeAgo } from "@/lib/format";
import { toastResult } from "@/lib/toast-result";
import { deleteAutomation, renameAutomation, setAutomationEnabled } from "../actions";

export type AutomationRow = { name: string; title: string; enabled: boolean; triggers: { provider: string; event: string; schedule?: { cron: string } }[]; lastRun?: string };

export function AutomationsTable({ factory, rows }: { factory: string; rows: AutomationRow[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [optimistic, setOptimistic] = useState<Record<string, boolean>>({});
  const [renaming, setRenaming] = useState<AutomationRow | null>(null);
  const [deleting, setDeleting] = useState<AutomationRow | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const offset = typeof window === "undefined" ? 0 : localOffset();

  const toggle = (row: AutomationRow, enabled: boolean) => {
    setOptimistic((o) => ({ ...o, [row.name]: enabled }));
    start(async () => {
      const r = await setAutomationEnabled(factory, row.name, enabled);
      if (!toastResult(r, enabled ? `${row.title} resumed` : `${row.title} paused`)) setOptimistic((o) => ({ ...o, [row.name]: !enabled }));
      router.refresh();
    });
  };

  if (!rows.length) {
    return (
      <div className="rounded-xl border px-6 py-12 text-center">
        <p className="font-medium">No automations yet</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">Automations start agents from events, schedules and webhooks. Pick a suggestion below or create one from scratch.</p>
        <Link className={buttonVariants({ className: "mt-4" })} href={`/f/${factory}/automations/new`}>
          New automation
        </Link>
      </div>
    );
  }

  return (
    <>
      <div className="overflow-hidden rounded-xl border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="px-4 py-3 font-normal">Automation</th>
              <th className="px-4 py-3 font-normal">Trigger</th>
              <th className="w-28 px-4 py-3 font-normal">Last run</th>
              <th className="w-24 px-4 py-3 font-normal">Enabled</th>
              <th className="w-12 px-2 py-3">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const enabled = optimistic[row.name] ?? row.enabled;
              return (
                <tr key={row.name} className="group border-b last:border-0 hover:bg-muted/40">
                  <td className="px-4 py-3 font-medium">
                    <Link href={`/f/${factory}/automations/${encodeURIComponent(row.name)}`} className="hover:underline">
                      {row.title}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {triggerSummary(row.triggers, offset)}
                    <span className="sr-only">{`${row.triggers.length} triggers`}</span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{row.lastRun ? timeAgo(row.lastRun) : "—"}</td>
                  <td className="px-4 py-3">
                    <Switch aria-label={`${row.title} active`} checked={enabled} disabled={pending} onCheckedChange={(v) => toggle(row, v)} />
                  </td>
                  <td className="px-2 py-3">
                    <DropdownMenu>
                      <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Open menu" className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 aria-expanded:opacity-100" />}>
                        <EllipsisVertical />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-40">
                        <DropdownMenuItem onClick={() => (setNewTitle(row.title), setRenaming(row))}>
                          <Pencil /> Rename
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => toggle(row, !enabled)}>
                          {enabled ? <Pause /> : <Play />} {enabled ? "Pause" : "Resume"}
                        </DropdownMenuItem>
                        <DropdownMenuItem variant="destructive" onClick={() => setDeleting(row)}>
                          <Trash2 /> Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Dialog open={Boolean(renaming)} onOpenChange={(o) => !o && setRenaming(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Rename automation</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const row = renaming!;
              start(async () => {
                if (toastResult(await renameAutomation(factory, row.name, newTitle), "Automation renamed")) setRenaming(null);
                router.refresh();
              });
            }}
            className="space-y-4"
          >
            <Input autoFocus aria-label="Automation name" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} />
            <p className="text-xs text-muted-foreground">The display name changes; the file stays at automations/{renaming?.name}/automation.md.</p>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setRenaming(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending || !newTitle.trim()}>
                Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(deleting)} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleting?.title}?</AlertDialogTitle>
            <AlertDialogDescription>This removes automations/{deleting?.name} from the factory definition. Runs it already started keep going.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                const row = deleting!;
                start(async () => {
                  toastResult(await deleteAutomation(factory, row.name), "Automation deleted");
                  setDeleting(null);
                  router.refresh();
                });
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
