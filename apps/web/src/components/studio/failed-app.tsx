"use client";

import { CircleX, RotateCcw, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "@/lib/toast";
import type { StudioApp } from "@/lib/studio/types";
import { Confirm } from "./confirm";

/** Retry and Delete for an App whose setup failed; Delete asks first. */
export function FailedAppActions({ app, onRetry, onDelete }: { app: StudioApp; onRetry: () => Promise<void>; onDelete: () => Promise<void> }) {
  const [retrying, setRetrying] = useState(false);
  const fail = (e: unknown) => toast.error(e instanceof Error ? e.message : String(e));
  return (
    <div className="flex items-center gap-2">
      <Button
        size="sm"
        disabled={retrying}
        onClick={async () => {
          setRetrying(true);
          try {
            await onRetry();
          } catch (e) {
            fail(e);
          } finally {
            setRetrying(false);
          }
        }}
      >
        <RotateCcw />
        Retry
      </Button>
      <Confirm
        trigger={
          <Button size="sm" variant="outline">
            <Trash2 />
            Delete
          </Button>
        }
        icon={<Trash2 />}
        title={`Delete ${app.name}?`}
        description="Its workspace, chats and versions are removed. This can't be undone."
        action="Delete"
        onConfirm={() => onDelete().catch(fail)}
      />
    </div>
  );
}

/** A template App whose setup failed: what failed, with Retry and Delete. */
export function FailedApp({ app, onRetry, onDelete }: { app: StudioApp; onRetry: () => Promise<void>; onDelete: () => Promise<void> }) {
  return (
    <div className="flex h-full items-start justify-center overflow-y-auto p-6 sm:items-center">
      <div className="flex w-full max-w-md flex-col gap-4">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl border bg-background">
            <CircleX className="size-5 text-destructive" />
          </div>
          <div className="min-w-0">
            <div className="truncate font-medium">Setting up {app.name} failed</div>
            <div className="text-xs text-muted-foreground">Retry sets it up again on a fresh workspace.</div>
          </div>
        </div>
        {app.error && (
          <pre className="max-h-64 overflow-auto rounded-md border bg-muted/50 p-3 font-mono text-xs whitespace-pre-wrap text-destructive">{app.error}</pre>
        )}
        <FailedAppActions app={app} onRetry={onRetry} onDelete={onDelete} />
      </div>
    </div>
  );
}
