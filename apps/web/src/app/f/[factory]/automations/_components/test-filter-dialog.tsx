"use client";

import { useEffect, useState, useTransition } from "react";
import { CheckCircle2, ChevronRight, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { TriggerModel } from "@/lib/automations/model";
import type { Delivery } from "@/lib/api/webhooks";
import type { FilterTestView } from "@/lib/automations/test-filter";
import { timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import { recentDeliveries, testAutomationFilter } from "../actions";

/** Evaluate the saved automation's trigger against a stored delivery: "Would trigger" / "Would not trigger". */
export function TestFilterDialog({ factory, name, trigger, index, onClose }: { factory: string; name: string; trigger: TriggerModel | null; index?: number; onClose: () => void }) {
  const [deliveries, setDeliveries] = useState<Delivery[] | null>(null);
  const [selected, setSelected] = useState<string | undefined>();
  const [result, setResult] = useState<FilterTestView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  useEffect(() => {
    if (!trigger?.webhook) return;
    setDeliveries(null);
    setResult(null);
    setError(null);
    recentDeliveries(factory, trigger.webhook).then((d) => {
      const accepted = d.filter((x) => x.status === "accepted");
      setDeliveries(accepted);
      setSelected(accepted[0]?.id);
    });
  }, [factory, trigger]);
  const run = () =>
    start(async () => {
      if (!selected) return;
      const r = await testAutomationFilter(factory, name, selected, index);
      if (r.ok) {
        setResult(r.result);
        setError(null);
      } else setError(r.error);
    });
  return (
    <Dialog open={Boolean(trigger)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Test filter</DialogTitle>
          <DialogDescription>Check the saved trigger against a delivery the webhook already received. Save your edits first to test them.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Recent accepted deliveries</p>
          {deliveries === null ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : deliveries.length === 0 ? (
            <p className="rounded-lg border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">No deliveries yet. Send one to the webhook URL, then test again.</p>
          ) : (
            <div className="max-h-60 divide-y overflow-y-auto rounded-lg border">
              {deliveries.map((d) => (
                <button key={d.id} type="button" onClick={() => setSelected(d.id)} className={cn("flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-muted/50", selected === d.id && "bg-muted")}>
                  <ChevronRight className={cn("size-4 text-muted-foreground", selected === d.id && "text-foreground")} />
                  <span className="truncate font-mono text-xs">{d.deliveryId || d.id}</span>
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">{timeAgo(d.receivedAt)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        {result && (
          <div className={cn("rounded-lg border p-3", result.matched ? "border-emerald-300 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/40" : "border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950/40")}>
            <p className="flex items-center gap-2 font-medium">
              {result.matched ? <CheckCircle2 className="size-4 text-emerald-600" /> : <XCircle className="size-4 text-red-600" />}
              {result.matched ? (result.paused ? "Would trigger, but the automation is paused" : "Would trigger") : "Would not trigger"}
            </p>
            {result.trigger && <p className="mt-0.5 text-xs text-muted-foreground">Trigger: {result.trigger}</p>}
            <ul className="mt-2 space-y-1 text-sm">
              {result.checks.map((c, i) => (
                <li key={`${c.name}-${i}`} className="flex gap-2">
                  {c.passed ? <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-600" /> : <XCircle className="mt-0.5 size-3.5 shrink-0 text-red-600" />}
                  <span>
                    {c.name}
                    {c.detail && <span className="text-muted-foreground"> · {c.detail}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button onClick={run} disabled={pending || !selected}>
            {pending ? "Testing…" : "Run test"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
