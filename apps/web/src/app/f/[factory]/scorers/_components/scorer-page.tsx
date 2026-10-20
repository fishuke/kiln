"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { EllipsisVertical, Trash2 } from "lucide-react";
import { Field } from "@/components/kiln/form-controls";
import { PillTabs } from "@/components/kiln/pill-tabs";
import { PageHeader } from "@/components/kiln/ui";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import type { Resources } from "@/lib/api/resources";
import { scorerProblems, type ScorerModel } from "@/lib/scorers";
import { toastResult } from "@/lib/toast-result";
import { deleteScorer, saveScorer } from "../actions";
import { ScorerConfig } from "./scorer-config";
import { ScorerDetails, type ScoreRow } from "./scorer-details";

export function ScorerPage({ factory, factoryName, initial, res, scores, isNew, initialTab }: { factory: string; factoryName: string; initial: ScorerModel; res: Resources; scores: ScoreRow[]; isNew?: boolean; initialTab?: "details" | "config" }) {
  const router = useRouter();
  const [model, setModel] = useState(initial);
  const [baseline, setBaseline] = useState(() => JSON.stringify(initial));
  const [tab, setTab] = useState<"details" | "config">(isNew ? "config" : (initialTab ?? "details"));
  const [editTitle, setEditTitle] = useState(false);
  const [editDesc, setEditDesc] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [tried, setTried] = useState(false);
  const [pending, start] = useTransition();
  const dirty = JSON.stringify(model) !== baseline;
  const problems = scorerProblems(model);
  const valid = Object.keys(problems).length === 0;
  const errors = tried ? problems : {};

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const save = () => {
    setTried(true);
    if (!valid) return;
    start(async () => {
      const r = await saveScorer(factory, isNew ? null : initial.slug, model);
      if (!toastResult(r, isNew ? "Scorer created" : "Scorer saved")) return;
      setBaseline(JSON.stringify(model));
      if (isNew && r.ok && r.slug && !r.pullRequest) router.push(`/f/${factory}/scorers/${encodeURIComponent(r.slug)}?tab=config`);
      else router.refresh();
    });
  };

  const saveButton = (
    <Button onClick={save} disabled={pending || !dirty} variant={dirty ? "default" : "secondary"}>
      {pending ? "Saving…" : "Save"}
    </Button>
  );

  return (
    <>
      <PageHeader
        crumbs={[{ label: factoryName, href: `/f/${factory}/dashboard` }, { label: "Scorers", href: `/f/${factory}/scorers` }, { label: isNew ? model.name || "Untitled" : model.name }]}
        actions={
          isNew ? (
            <>
              <Link href={`/f/${factory}/scorers`} className={buttonVariants({ variant: "outline" })}>
                Cancel
              </Link>
              {saveButton}
            </>
          ) : undefined
        }
      />
      <div className="mx-auto w-full max-w-[768px] px-6 py-10">
        <div className="flex items-start gap-4">
          <div className="min-w-0 flex-1">
            {isNew || editTitle ? (
              <input
                autoFocus={isNew}
                aria-label="Scorer name"
                value={model.name}
                onChange={(e) => setModel({ ...model, name: e.target.value })}
                onBlur={() => setEditTitle(false)}
                onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                placeholder="Enter scorer name"
                className="w-full bg-transparent text-[28px] leading-tight font-semibold tracking-tight outline-none placeholder:text-muted-foreground/70"
              />
            ) : (
              <h1>
                <button type="button" aria-label="Rename scorer" onClick={() => setEditTitle(true)} className="text-left text-[28px] leading-tight font-semibold tracking-tight hover:opacity-80">
                  {model.name}
                </button>
              </h1>
            )}
            {errors.name && <p className="mt-1 text-sm text-destructive">{errors.name}</p>}
            {!isNew &&
              (editDesc ? (
                <Textarea autoFocus aria-label="Description" value={model.description ?? ""} onChange={(e) => setModel({ ...model, description: e.target.value || undefined })} onBlur={() => setEditDesc(false)} className="mt-2" />
              ) : (
                <button type="button" aria-label="Edit description" onClick={() => setEditDesc(true)} className="mt-2 block text-left text-sm text-muted-foreground hover:text-foreground">
                  {model.description || "Add a description"}
                </button>
              ))}
          </div>
          {!isNew && tab === "config" && (
            <div className="flex items-center gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label="Open menu" />}>
                  <EllipsisVertical />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-36">
                  <DropdownMenuItem variant="destructive" onClick={() => setConfirm(true)}>
                    <Trash2 /> Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              {saveButton}
            </div>
          )}
        </div>
        {isNew ? (
          <div className="mt-8 space-y-8">
            <Field label="Description" help="Summarize what this scorer measures, for anyone browsing your scorers.">
              <Textarea aria-label="Description" value={model.description ?? ""} onChange={(e) => setModel({ ...model, description: e.target.value || undefined })} placeholder="E.g. “Checks that agent responses stay concise”" />
            </Field>
            <ScorerConfig model={model} onChange={setModel} res={res} errors={errors} isNew />
          </div>
        ) : (
          <>
            <div className="mt-6 mb-8">
              <PillTabs
                tabs={[
                  { id: "details", label: "Details" },
                  { id: "config", label: "Config" },
                ]}
                value={tab}
                onChange={setTab}
              />
            </div>
            {tab === "details" ? (
              <ScorerDetails factory={factory} scorer={initial.slug} rows={scores} agents={model.agents.map((a) => a.name)} passingScore={model.passingScore} />
            ) : (
              <div className="px-0 sm:px-8">
                <ScorerConfig model={model} onChange={setModel} res={res} errors={errors} />
              </div>
            )}
          </>
        )}
      </div>
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {model.name}?</AlertDialogTitle>
            <AlertDialogDescription>Runs stop being scored by it. Recorded scores stay in the history.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() =>
                start(async () => {
                  if (toastResult(await deleteScorer(factory, initial.slug), "Scorer deleted")) {
                    setBaseline(JSON.stringify(model));
                    router.push(`/f/${factory}/scorers`);
                  }
                })
              }
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
