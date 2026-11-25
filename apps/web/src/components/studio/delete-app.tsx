"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import type { StudioClient } from "@/lib/studio/client";
import type { StudioApp } from "@/lib/studio/types";

/**
 * Asks before deleting an App. What goes: its chats, versions, Context and sandbox. What stays: its
 * GitHub repository, which is the person's code. The server refuses while the agent is working.
 */
export function DeleteAppDialog({
  client,
  app,
  open,
  onOpenChange,
  onDeleted,
}: {
  client: StudioClient;
  app: Pick<StudioApp, "id" | "name" | "source">;
  open: boolean;
  onOpenChange(open: boolean): void;
  onDeleted?(): void;
}) {
  const [busy, setBusy] = useState(false);
  const remove = async () => {
    setBusy(true);
    try {
      await client.deleteApp(app.id);
      onOpenChange(false);
      toast.success(`Deleted ${app.name}`);
      onDeleted?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <AlertDialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {app.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            {"Its Context, chats, versions and prototype go, for everyone in it. This can’t be undone."}
            {app.source.kind === "repo" ? ` The repository ${app.source.repo} stays as it is.` : " Its GitHub repository, if it has one, stays."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <Button variant="destructive" disabled={busy} onClick={() => void remove()}>
            {busy ? "Deleting…" : "Delete App"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
