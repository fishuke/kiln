"use client";

import { useState } from "react";
import { useAction } from "@/components/kiln/use-action";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { runCleanup, setCleanupScheduled } from "../actions";

/** Run now and the hourly schedule. The schedule only turns on after a run, so the first removal is always someone looking at the plan. */
export function CleanupControls({ scheduled, hasRun, empty }: { scheduled: boolean; hasRun: boolean; empty: boolean }) {
  const [on, setOn] = useState(scheduled);
  const [pending, run] = useAction();
  return (
    <div className="flex flex-wrap items-center gap-4">
      <Button disabled={pending} onClick={() => void run(() => runCleanup())}>
        {pending ? "Cleaning up…" : empty ? "Prune build cache" : "Clean up now"}
      </Button>
      <label className="flex items-center gap-2 text-sm">
        <Switch
          aria-label="Clean up every hour"
          checked={on}
          disabled={!hasRun && !on}
          onCheckedChange={(v) => {
            setOn(Boolean(v));
            void run(() => setCleanupScheduled(Boolean(v)));
          }}
        />
        Clean up every hour
        {!hasRun && !on && <span className="text-xs text-muted-foreground">(after the first run)</span>}
      </label>
    </div>
  );
}
