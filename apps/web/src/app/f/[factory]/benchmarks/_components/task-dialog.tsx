"use client";

import { useEffect, useState, useTransition } from "react";
import { Check, Plus, Search, Trash2 } from "lucide-react";
import { Field, TokenPicker } from "@/components/kiln/form-controls";
import { MarkdownEditor } from "@/components/kiln/markdown-editor";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { REPO_REF, type TaskModel } from "@/lib/benchmarks";
import { timeAgo, usd } from "@/lib/format";
import { cn } from "@/lib/utils";
import { searchRuns, type NewTask, type RunOption } from "../actions";

type Draft = Omit<TaskModel, "slug" | "extra">;
const emptyDraft: Draft = { title: "", prompt: "", successCriteria: [""], startingRepoRefs: [], tags: [] };

/** Criteria as an editable list of single-line inputs. */
function CriteriaList({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="space-y-2">
      {value.map((c, i) => (
        <div key={i} className="flex items-center gap-2">
          <Input aria-label={`Criterion ${i + 1}`} value={c} onChange={(e) => onChange(value.map((x, j) => (j === i ? e.target.value : x)))} placeholder="E.g. “The login form shows an error for a wrong password”" className="h-9" />
          <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove criterion ${i + 1}`} disabled={value.length === 1} onClick={() => onChange(value.filter((_, j) => j !== i))}>
            <Trash2 />
          </Button>
        </div>
      ))}
      <Button type="button" variant="ghost" size="sm" onClick={() => onChange([...value, ""])}>
        <Plus /> Add criterion
      </Button>
    </div>
  );
}

export function ScratchTaskForm({ draft, onChange }: { draft: Draft; onChange: (d: Draft) => void }) {
  return (
    <div className="space-y-5">
      <Field label="Title" required htmlFor="task-title">
        <Input id="task-title" value={draft.title} onChange={(e) => onChange({ ...draft, title: e.target.value })} placeholder="E.g. Fix the flaky login test" className="h-10" />
      </Field>
      <Field label="Prompt" required help="What the agent is asked to do, exactly as a person would ask it.">
        <MarkdownEditor value={draft.prompt} onChange={(prompt) => onChange({ ...draft, prompt })} minRows={6} />
      </Field>
      <Field label="Correctness criteria" required help="The Correctness Scorer checks each trial against these.">
        <CriteriaList value={draft.successCriteria} onChange={(successCriteria) => onChange({ ...draft, successCriteria })} />
      </Field>
      <Field label="Pinned repositories" help="Each trial starts from these exact commits: github.com:owner/repo@<40-character sha>.">
        <TokenPicker label="Pinned repositories" free values={draft.startingRepoRefs} onChange={(startingRepoRefs) => onChange({ ...draft, startingRepoRefs })} placeholder="github.com:owner/repo@sha" validate={(v) => (REPO_REF.test(v) ? null : "Use github.com:owner/repo@<40-character sha>")} />
      </Field>
      <Field label="Tags" help="Optional. Routing suggestions group tasks by tag.">
        <TokenPicker label="Tags" free values={draft.tags ?? []} onChange={(tags) => onChange({ ...draft, tags })} placeholder="add tags" />
      </Field>
    </div>
  );
}

export function draftProblem(d: Draft): string | null {
  if (!d.title.trim()) return "Add a title.";
  if (!d.prompt.trim()) return "Add a prompt.";
  if (!d.successCriteria.some((c) => c.trim())) return "Add at least one correctness criterion.";
  if (!d.startingRepoRefs.length) return "Pin at least one repository.";
  return null;
}

export function clean(d: Draft): Draft {
  return { ...d, title: d.title.trim(), successCriteria: d.successCriteria.map((c) => c.trim()).filter(Boolean), tags: d.tags?.length ? d.tags : undefined };
}

/** Add a task from a completed run (with search) or start from scratch. */
export function AddTaskDialog({ factory, agent, open, onClose, onAdd, pending }: { factory: string; agent?: string; open: boolean; onClose: () => void; onAdd: (t: NewTask) => void; pending?: boolean }) {
  const [mode, setMode] = useState<"run" | "scratch">("run");
  const [q, setQ] = useState("");
  const [runs, setRuns] = useState<RunOption[] | null>(null);
  const [picked, setPicked] = useState<RunOption | null>(null);
  const [title, setTitle] = useState("");
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [loading, start] = useTransition();
  useEffect(() => {
    if (!open || mode !== "run") return;
    const t = setTimeout(() => start(async () => setRuns(await searchRuns(factory, agent, q))), 200);
    return () => clearTimeout(t);
  }, [open, mode, q, factory, agent]);
  useEffect(() => {
    if (!open) {
      setMode("run");
      setQ("");
      setPicked(null);
      setTitle("");
      setDraft(emptyDraft);
    }
  }, [open]);
  const problem = mode === "scratch" ? draftProblem(draft) : picked ? null : "Choose a run.";
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[672px]">
        <DialogHeader>
          <DialogTitle>Add task</DialogTitle>
          <DialogDescription>{mode === "run" ? "Turn a completed run into a task. Its prompt and repository commits are pinned so every trial starts from the same place." : "Write the task yourself."}</DialogDescription>
        </DialogHeader>
        {mode === "run" ? (
          <div className="space-y-3">
            <div className="relative">
              <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input autoFocus aria-label="Search runs" value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search completed runs${agent ? ` of ${agent}` : ""}…`} className="h-10 pl-8" />
            </div>
            <div className="max-h-72 divide-y overflow-y-auto rounded-lg border">
              {runs === null || (loading && !runs.length) ? (
                <p className="px-3 py-6 text-center text-sm text-muted-foreground">Loading…</p>
              ) : runs.length === 0 ? (
                <p className="px-3 py-6 text-center text-sm text-muted-foreground">No completed runs match.</p>
              ) : (
                runs.map((r) => (
                  <button key={r.id} type="button" onClick={() => (setPicked(r), setTitle(r.title))} className={cn("flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-muted/50", picked?.id === r.id && "bg-muted")}>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{r.title}</span>
                      <span className="block text-xs text-muted-foreground">
                        {r.agent} · {timeAgo(r.finishedAt)} · {usd(r.costUsd)}
                      </span>
                    </span>
                    {picked?.id === r.id && <Check className="size-4" />}
                  </button>
                ))
              )}
            </div>
            {picked && (
              <Field label="Task title" htmlFor="run-title">
                <Input id="run-title" value={title} onChange={(e) => setTitle(e.target.value)} className="h-10" />
              </Field>
            )}
            <button type="button" className="text-sm font-medium text-violet-600 hover:underline dark:text-violet-400" onClick={() => setMode("scratch")}>
              Start from scratch instead
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <ScratchTaskForm draft={draft} onChange={setDraft} />
            <button type="button" className="text-sm font-medium text-violet-600 hover:underline dark:text-violet-400" onClick={() => setMode("run")}>
              Pick a completed run instead
            </button>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={Boolean(problem) || pending} title={problem ?? undefined} onClick={() => onAdd(mode === "scratch" ? { kind: "scratch", task: clean(draft) } : { kind: "run", runId: picked!.id, title: title.trim() || picked!.title })}>
            Add task
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
