"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Plus, Search, Trash2 } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { PageHeader } from "@/components/kiln/ui";
import { Button, buttonVariants } from "@/components/ui/button";
import { toastResult } from "@/lib/toast-result";
import { addDefaultScorers, deleteScorer } from "../actions";

export type ScorerCard = { slug: string; name: string; classifications: number; agents: string[]; passRate?: number; scored: number };

export function ScorerSearch({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  return open || value ? (
    <input autoFocus aria-label="Search scorers" value={value} onChange={(e) => onChange(e.target.value)} onBlur={() => !value && setOpen(false)} placeholder="Search scorers…" className="h-8 w-56 rounded-lg border bg-background px-2.5 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50" />
  ) : (
    <Button variant="outline" size="icon" aria-label="Search scorers" onClick={() => setOpen(true)}>
      <Search />
    </Button>
  );
}

/** Header (search + New) and list share the search text. */
export function ScorersView(p: { factory: string; factoryName: string; cards: ScorerCard[]; missingDefaults: { slug: string; name: string; description?: string }[]; judgeModel: string }) {
  const [q, setQ] = useState("");
  return (
    <>
      <PageHeader
        crumbs={[{ label: p.factoryName, href: `/f/${p.factory}/dashboard` }, { label: "Scorers" }]}
        actions={
          <>
            <ScorerSearch value={q} onChange={setQ} />
            <Link href={`/f/${p.factory}/scorers/new`} className={buttonVariants()}>
              New
            </Link>
          </>
        }
      />
      <div className="px-4 py-8 sm:px-6">
        <ScorerList factory={p.factory} cards={p.cards} missingDefaults={p.missingDefaults} judgeModel={p.judgeModel} search={q} />
      </div>
    </>
  );
}

export function ScorerList({ factory, cards, missingDefaults, judgeModel, search }: { factory: string; cards: ScorerCard[]; missingDefaults: { slug: string; name: string; description?: string }[]; judgeModel: string; search: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [deleting, setDeleting] = useState<ScorerCard | null>(null);
  const shown = cards.filter((c) => !search || c.name.toLowerCase().includes(search.toLowerCase()));
  const addDefaults = (slugs: string[]) =>
    start(async () => {
      toastResult(await addDefaultScorers(factory, slugs, judgeModel), slugs.length > 1 ? "Built-in scorers added" : "Scorer added");
      router.refresh();
    });
  return (
    <>
      <div className="space-y-4">
        {shown.map((c) => (
          <div key={c.slug} className="relative flex items-center rounded-xl border bg-background transition-colors hover:bg-muted/30">
            <Link href={`/f/${factory}/scorers/${encodeURIComponent(c.slug)}`} className="min-w-0 flex-1 px-5 py-5">
              <div className="text-lg font-semibold">{c.name}</div>
              <div className="mt-0.5 truncate text-sm text-muted-foreground">
                {[`${c.classifications} outcome classification${c.classifications === 1 ? "" : "s"}`, ...c.agents].join(" • ")}
                {c.scored > 0 && c.passRate !== undefined && <span> • {Math.round(c.passRate * 100)}% pass rate</span>}
              </div>
            </Link>
            <Button variant="ghost" size="icon" aria-label={`Delete ${c.name}`} className="mr-4 text-red-600 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-950/40" onClick={() => setDeleting(c)}>
              <Trash2 />
            </Button>
          </div>
        ))}
        {!cards.length && (
          <div className="rounded-2xl bg-muted/60 px-6 py-16 text-center">
            <p className="font-medium">No scorers yet</p>
            <p className="mt-1 text-sm text-muted-foreground">Scorers grade sampled runs with a judge model. Start from the built-in ones or write your own.</p>
          </div>
        )}
      </div>
      {missingDefaults.length > 0 && (
        <section className="mt-10">
          <div className="mb-3 flex items-end justify-between">
            <div>
              <h2 className="text-sm font-semibold">Built-in scorers</h2>
              <p className="text-sm text-muted-foreground">Every factory starts with these five. Add any that are missing.</p>
            </div>
            {missingDefaults.length > 1 && (
              <Button variant="outline" disabled={pending} onClick={() => addDefaults(missingDefaults.map((d) => d.slug))}>
                Add all
              </Button>
            )}
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {missingDefaults.map((d) => (
              <div key={d.slug} className="flex items-start gap-3 rounded-xl border border-dashed p-4">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{d.name}</div>
                  <p className="mt-0.5 text-sm text-muted-foreground">{d.description}</p>
                </div>
                <Button variant="outline" size="sm" disabled={pending} onClick={() => addDefaults([d.slug])}>
                  <Plus /> Add
                </Button>
              </div>
            ))}
          </div>
        </section>
      )}
      <AlertDialog open={Boolean(deleting)} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleting?.name}?</AlertDialogTitle>
            <AlertDialogDescription>Runs stop being scored by it. Scores it already recorded stay in the history.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                const c = deleting!;
                setDeleting(null);
                start(async () => {
                  toastResult(await deleteScorer(factory, c.slug), "Scorer deleted");
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
