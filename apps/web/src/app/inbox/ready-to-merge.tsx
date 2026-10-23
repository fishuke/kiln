"use client";

import type { ReadyToMerge as Ready } from "@kiln/sdk-ts";
import { ChevronDown, ChevronRight, GitMerge, GitPullRequest } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { mergeTask } from "./review-actions";

/**
 * Pull requests the review-risk check cleared: no one needs to read the code, so they are not
 * inbox items, but a person still merges them (ADR-008). One click merges as you.
 */
export function ReadyToMerge({ items }: { items: Ready[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string>();
  if (!items.length) return null;

  const merge = (taskId: string) => {
    setBusy(taskId);
    start(async () => {
      const r = await mergeTask(taskId);
      setBusy(undefined);
      if (!r.ok) toast.error("Could not merge", { description: r.error });
      else {
        toast.success("Merged");
        router.refresh();
      }
    });
  };

  return (
    <section aria-label="Ready to merge" className="mx-2 mt-2 rounded-lg border">
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/50">
        {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        <GitMerge className="size-4 text-emerald-600 dark:text-emerald-400" />
        <span className="font-medium">Ready to merge</span>
        <span className="text-muted-foreground">
          {items.length} low-risk pull request{items.length === 1 ? "" : "s"}, no code review needed
        </span>
      </button>
      {open && (
        <ul className="border-t">
          {items.map((i) => (
            <li key={i.taskId} className="flex items-center gap-3 px-3 py-2 text-sm">
              <Link href={`/runs/${i.taskId}`} className="min-w-0 flex-1 truncate hover:underline">
                {i.title}
              </Link>
              <a
                href={i.pr.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <GitPullRequest className="size-3.5" />#{i.pr.number}
              </a>
              <Button size="sm" variant="outline" disabled={pending} onClick={() => merge(i.taskId)}>
                {busy === i.taskId ? "Merging…" : "Merge"}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
