"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { useAction } from "@/components/kiln/use-action";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { createTeam } from "./actions";

export function NewTeamButton() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [pending, run] = useAction();
  const router = useRouter();
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Plus /> New team
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void run(() => createTeam(name), {
                onSuccess: () => {
                  setOpen(false);
                  setName("");
                  router.refresh();
                },
              });
            }}
          >
            <DialogHeader>
              <DialogTitle>Create a team</DialogTitle>
              <DialogDescription>Teams have their own factories, members, secrets and spend limit. You become the owner.</DialogDescription>
            </DialogHeader>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Team name" autoFocus required className="h-9" />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending || !name.trim()}>
                {pending ? "Creating…" : "Create team"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
