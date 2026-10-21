"use client";

import type { SpecRetryOptions } from "@kiln/sdk-ts";
import { Check, ExternalLink, GitPullRequest, Globe, RotateCcw, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { decide, retrySpec, specRetryOptions } from "@/app/runs/actions";
import { Markdown } from "@/components/kiln/markdown";
import { ModelSelect } from "@/components/kiln/resource-pickers";
import { Button } from "@/components/ui/button";
import { canRetrySpec, questionOptions, questionPrompt, retryModel } from "@/lib/inbox-model";
import type { GateView } from "@/lib/run-detail";
import { cn } from "@/lib/utils";

/**
 * A decision the factory waits on: approve a spec, accept a preview, answer a question (single
 * or multi-select with a recommended option), confirm a merge, or allow a guarded command. A spec
 * review, or the question a failed spec run left, can also be retried on a model of your choice.
 */
export function GateCard({ gate, prUrl, previewUrl, onDone, compact, hideQuestion }: { gate: GateView; prUrl?: string; previewUrl?: string; onDone?: (decision: string) => void; compact?: boolean; hideQuestion?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [note, setNote] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [retry, setRetry] = useState<SpecRetryOptions>();
  const [model, setModel] = useState("");
  const isQuestion = gate.kind === "question" && !gate.command;
  const options = isQuestion ? questionOptions(gate) : [];
  const prompt = isQuestion ? questionPrompt(gate.question) : gate.question;
  const preview = previewUrl ?? gate.evidence.find((e) => e.label.toLowerCase() === "preview")?.url;
  const links = gate.evidence.filter((e) => e.url !== preview);

  const send = (decision: "approve" | "reject" | "answer") => {
    const answer = decision === "answer" ? [picked.join(", "), note.trim()].filter(Boolean).join("\n\n") : note.trim();
    if (decision === "answer" && !answer) {
      toast.error("Pick an option or write an answer");
      return;
    }
    start(async () => {
      const r = await decide({ gateId: gate.id, decision, answer: answer || undefined });
      if (!r.ok) {
        toast.error("Could not send your decision", { description: r.error });
        return;
      }
      toast.success(decision === "answer" ? "Answer sent" : decision === "approve" ? approveDone(gate) : "Sent back to the agents");
      onDone?.(decision);
      router.refresh();
    });
  };

  const openRetry = () =>
    start(async () => {
      const r = await specRetryOptions(gate.id);
      if (!r.ok) {
        toast.error("Could not load the spec agent's models", { description: r.error });
        return;
      }
      setRetry(r.options);
      setModel(r.options.model ?? "");
    });

  const sendRetry = () =>
    start(async () => {
      const r = await retrySpec({ gateId: gate.id, model: retryModel(model, retry?.model) });
      if (!r.ok) {
        toast.error("Could not retry the spec", { description: r.error });
        return;
      }
      toast.success("Writing the spec again");
      setRetry(undefined);
      onDone?.("retry");
      router.refresh();
    });

  const toggle = (label: string) => setPicked((p) => (gate.multiSelect ? (p.includes(label) ? p.filter((x) => x !== label) : [...p, label]) : [label]));

  return (
    <div className={cn("rounded-xl border bg-background p-4 shadow-xs dark:bg-muted/20", compact && "border-0 p-0 shadow-none dark:bg-transparent")}>
      {!compact && (
        <div className="mb-2 flex items-center gap-2 text-sm font-medium">
          <span className="size-2 rounded-full bg-orange-500" />
          {gate.title}
        </div>
      )}
      {gate.command ? (
        <div className="text-sm">
          The guardrail stopped this command and asks whether to run it:
          <pre className="mt-2 overflow-x-auto rounded-lg bg-muted p-3 font-mono text-xs">{gate.command}</pre>
        </div>
      ) : (
        prompt && !hideQuestion && <Markdown className="max-h-96 overflow-y-auto text-sm">{prompt}</Markdown>
      )}
      {options.length > 0 && (
        <div role={gate.multiSelect ? "group" : "radiogroup"} aria-label="Options" className="mt-3 flex flex-col gap-1.5">
          {options.map((o) => {
            const on = picked.includes(o.label);
            return (
              <button
                key={o.label}
                type="button"
                role={gate.multiSelect ? "checkbox" : "radio"}
                aria-checked={on}
                onClick={() => toggle(o.label)}
                className={cn("flex items-center gap-2.5 rounded-lg border px-3 py-2 text-left text-sm hover:bg-muted", on && "border-foreground/40 bg-muted")}
              >
                <span className={cn("flex size-4 shrink-0 items-center justify-center border", gate.multiSelect ? "rounded-[4px]" : "rounded-full", on && "border-violet-600 bg-violet-600 text-white")}>{on && <Check className="size-3" />}</span>
                <span className="flex-1">{o.label}</span>
                {o.recommended && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-violet-500/10 px-2 py-0.5 text-xs font-medium text-violet-700 dark:text-violet-300">
                    <Sparkles className="size-3" />
                    Recommended
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
      {(preview || prUrl || links.length > 0) && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {preview && (
            <a href={preview} target="_blank" rel="noreferrer" className="inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs font-medium hover:bg-muted">
              <Globe className="size-3.5" /> Open preview
            </a>
          )}
          {prUrl && (
            <a href={prUrl} target="_blank" rel="noreferrer" className="inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs font-medium hover:bg-muted">
              <GitPullRequest className="size-3.5" /> View PR
            </a>
          )}
          {links.map((e) => (
            <a key={e.url} href={e.url} target="_blank" rel="noreferrer" className="inline-flex h-7 items-center gap-1 rounded-md border px-2 text-xs hover:bg-muted">
              {e.label} <ExternalLink className="size-3" />
            </a>
          ))}
        </div>
      )}
      {gate.state === "open" && (
        <>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder={isQuestion ? (options.length ? "Add details (optional)" : "Your answer") : "Optional note; with Request changes it goes to the agents"}
            className="mt-3 w-full resize-none rounded-lg border bg-background p-2.5 text-sm outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring/30 dark:bg-transparent"
          />
          <div className="mt-2 flex flex-wrap gap-2">
            {isQuestion ? (
              <>
                <Button disabled={pending} onClick={() => send("answer")}>
                  Answer
                </Button>
                <Button variant="outline" disabled={pending} onClick={() => send("reject")}>
                  Stop the work
                </Button>
              </>
            ) : (
              <>
                <Button disabled={pending} onClick={() => send("approve")}>
                  {approveLabel(gate)}
                </Button>
                <Button variant="outline" disabled={pending} onClick={() => send("reject")}>
                  {gate.command ? "Block it" : "Request changes"}
                </Button>
              </>
            )}
            {canRetrySpec(gate) && !retry && (
              <Button variant="ghost" disabled={pending} onClick={openRetry}>
                <RotateCcw className="size-3.5" /> Retry
              </Button>
            )}
          </div>
          {retry && (
            <div className="mt-3 rounded-lg border p-3">
              <div className="mb-2 text-sm text-muted-foreground">
                Write the spec again from scratch, without the notes so far.{retry.writtenWith ? ` This one was written by ${retry.writtenWith}.` : ""}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="min-w-56 flex-1">
                  <ModelSelect value={model} onChange={setModel} harness={retry.harness} routers={retry.routers} defaultModel={retry.model} inheritLabel={retry.model ? undefined : ""} placeholder={`${retry.agent}'s model`} disabled={pending} />
                </div>
                <Button disabled={pending} onClick={sendRetry}>
                  Retry spec
                </Button>
                <Button variant="ghost" disabled={pending} onClick={() => setRetry(undefined)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function approveLabel(g: Pick<GateView, "kind" | "command">): string {
  if (g.command) return "Run it";
  if (g.kind === "spec") return "Approve spec";
  if (g.kind === "preview") return "Accept preview";
  if (g.kind === "merge") return "Confirm it landed";
  return "Approve";
}

function approveDone(g: GateView): string {
  if (g.kind === "spec") return "Spec approved";
  if (g.kind === "preview") return "Preview accepted";
  if (g.kind === "merge") return "Marked as landed";
  return "Approved";
}
