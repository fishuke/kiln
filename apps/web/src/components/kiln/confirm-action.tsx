"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
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
import { toast } from "sonner";
import { useAction } from "./use-action";

type Result = { ok: true; message?: string } | { ok: false; error: string };

/** A trigger that asks for confirmation, then runs a server action and toasts the result. */
export function ConfirmAction({
  trigger,
  title,
  description,
  confirmLabel = "Delete",
  destructive = true,
  action,
  success,
  onDone,
}: {
  trigger: (open: () => void) => React.ReactNode;
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
  action: () => Promise<Result>;
  success?: string;
  onDone?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [pending, run] = useAction();
  return (
    <>
      {trigger(() => setOpen(true))}
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{title}</AlertDialogTitle>
            {description && <AlertDialogDescription>{description}</AlertDialogDescription>}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button
              variant={destructive ? "destructive" : "default"}
              disabled={pending}
              onClick={() =>
                void run(action, {
                  success,
                  onSuccess: () => {
                    setOpen(false);
                    onDone?.();
                  },
                })
              }
            >
              {pending ? "Working…" : confirmLabel}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export function CopyButton({ value, label = "Copy", className, variant = "outline", size = "sm" }: { value: string; label?: string; className?: string; variant?: "outline" | "ghost" | "default"; size?: "sm" | "default" | "icon-sm" }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      className={className}
      aria-label={label}
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(
          () => {
            setDone(true);
            toast.success("Copied to clipboard");
            setTimeout(() => setDone(false), 1500);
          },
          () => toast.error("Could not copy"),
        );
      }}
    >
      {done ? <Check /> : <Copy />}
      {size !== "icon-sm" && label}
    </Button>
  );
}
