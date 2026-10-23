"use client";

import type { PullRequestFileView, ReviewSubmission, TaskReview } from "@kiln/sdk-ts";
import { ChevronDown, ChevronRight, GitMerge, GitPullRequest, MessageSquarePlus, Sparkles, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "@/lib/toast";
import { loadReview, mergeTask, startGitHubLink, submitReview } from "@/app/inbox/review-actions";
import { GitHubIcon } from "@/components/kiln/brand-icons";
import { Button } from "@/components/ui/button";
import { commentTarget, parsePatch, type DiffLine } from "@/lib/diff";
import { cn } from "@/lib/utils";

type Draft = { path: string; line: number; side: "LEFT" | "RIGHT"; body: string };
const key = (d: Pick<Draft, "path" | "line" | "side">) => `${d.path}:${d.side}:${d.line}`;

/**
 * Review a factory pull request without leaving Kiln: the diff per file, comments on lines, and
 * Approve / Request changes / Merge as the person's linked GitHub account.
 */
export function ReviewPanel({ taskId, onDone }: { taskId: string; onDone?: () => void }) {
  const router = useRouter();
  const [review, setReview] = useState<TaskReview | null>(null);
  const [error, setError] = useState<string>();
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [editing, setEditing] = useState<string>();
  const [summary, setSummary] = useState("");
  const [pending, start] = useTransition();

  useEffect(() => {
    let live = true;
    void loadReview(taskId).then((r) => {
      if (!live) return;
      if (r.ok) setReview(r.data!);
      else setError(r.error);
    });
    return () => {
      live = false;
    };
  }, [taskId]);

  if (error) return <p className="text-sm text-destructive">Could not load the changes: {error}</p>;
  if (!review) return <p className="text-sm text-muted-foreground">Loading the changes…</p>;

  const send = (event: ReviewSubmission["event"]) => {
    if (event === "REQUEST_CHANGES" && !summary.trim() && !drafts.length) {
      toast.error("Say what to change, or comment on a line");
      return;
    }
    start(async () => {
      const r = await submitReview(taskId, {
        event,
        body: summary.trim() || undefined,
        comments: drafts.filter((d) => d.body.trim()).map(({ path, line, side, body }) => ({ path, line, side, body })),
      });
      if (!r.ok) {
        toast.error("Could not send your review", { description: r.error });
        return;
      }
      toast.success(event === "APPROVE" ? "Approved on GitHub" : event === "REQUEST_CHANGES" ? "Sent back to the agents" : "Comments posted");
      setDrafts([]);
      setSummary("");
      if (event === "REQUEST_CHANGES") onDone?.();
      router.refresh();
    });
  };

  const merge = () =>
    start(async () => {
      const r = await mergeTask(taskId);
      if (!r.ok) {
        toast.error("Could not merge", { description: r.error });
        return;
      }
      toast.success("Merged");
      onDone?.();
      router.refresh();
    });

  const link = () =>
    start(async () => {
      const r = await startGitHubLink();
      if (r.ok) window.location.href = r.data!.url;
      else toast.error("Could not start linking GitHub", { description: r.error });
    });

  const totals = review.files.reduce((t, f) => ({ add: t.add + f.additions, del: t.del + f.deletions }), { add: 0, del: 0 });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>
          {review.files.length} file{review.files.length === 1 ? "" : "s"} · <span className="text-emerald-600 dark:text-emerald-400">+{totals.add}</span>{" "}
          <span className="text-red-600 dark:text-red-400">−{totals.del}</span>
        </span>
        {review.pr && (
          <a href={review.pr.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-foreground">
            <GitPullRequest className="size-3.5" /> {review.pr.repo}#{review.pr.number}
          </a>
        )}
      </div>

      {review.findings.length > 0 && (
        <div className="rounded-lg border bg-muted/40 p-3 text-sm">
          <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Sparkles className="size-3.5 text-violet-500" /> The reviewer agent flagged
          </div>
          <ul className="list-disc space-y-0.5 pl-5">
            {review.findings.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </div>
      )}

      {!review.account.linked && (
        <div className="flex items-center gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
          <GitHubIcon className="size-4 shrink-0" />
          <span className="flex-1">Link your GitHub account to comment, approve and merge here. Kiln acts as you, never as the app.</span>
          <Button size="sm" variant="outline" disabled={pending} onClick={link}>
            Link GitHub
          </Button>
        </div>
      )}

      <div className="flex flex-col gap-2">
        {review.files.map((f) => (
          <FileDiff
            key={f.path}
            file={f}
            drafts={drafts.filter((d) => d.path === f.path)}
            editing={editing}
            canComment={review.account.linked}
            onEdit={setEditing}
            onDrafts={(next) => setDrafts((all) => [...all.filter((d) => d.path !== f.path), ...next])}
          />
        ))}
      </div>

      {review.account.linked && (
        <div className="sticky bottom-0 -mx-1 flex flex-col gap-2 border-t bg-background px-1 pt-3">
          <textarea
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            rows={2}
            placeholder={
              drafts.length
                ? `Summary for your ${drafts.length} comment${drafts.length === 1 ? "" : "s"} (optional)`
                : "Leave a review summary; with Request changes it goes to the agents"
            }
            className="w-full resize-none rounded-lg border bg-background p-2.5 text-sm outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring/30 dark:bg-transparent"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button disabled={pending} onClick={() => send("APPROVE")}>
              Approve
            </Button>
            <Button variant="outline" disabled={pending} onClick={() => send("REQUEST_CHANGES")}>
              Request changes
            </Button>
            {drafts.length > 0 && (
              <Button variant="ghost" disabled={pending} onClick={() => send("COMMENT")}>
                Comment only
              </Button>
            )}
            <span className="flex-1" />
            <Button variant="outline" disabled={pending} onClick={merge} title={`Merge as ${review.account.login}`}>
              <GitMerge /> Merge
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">As {review.account.login} on GitHub.</p>
        </div>
      )}
    </div>
  );
}

function FileDiff({
  file,
  drafts,
  editing,
  canComment,
  onEdit,
  onDrafts,
}: {
  file: PullRequestFileView;
  drafts: Draft[];
  editing?: string;
  canComment: boolean;
  onEdit: (k?: string) => void;
  onDrafts: (d: Draft[]) => void;
}) {
  const [open, setOpen] = useState(file.additions + file.deletions <= 400);
  const lines = parsePatch(file.patch);
  const byKey = new Map(drafts.map((d) => [key(d), d]));
  const setBody = (d: Draft, body: string) => onDrafts([...drafts.filter((x) => key(x) !== key(d)), { ...d, body }]);
  const remove = (d: Draft) => onDrafts(drafts.filter((x) => key(x) !== key(d)));

  return (
    <div className="overflow-hidden rounded-lg border">
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 bg-muted/50 px-3 py-2 text-left text-xs hover:bg-muted">
        {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        <span className="min-w-0 flex-1 truncate font-mono">{file.previousPath ? `${file.previousPath} → ${file.path}` : file.path}</span>
        {drafts.length > 0 && <span className="rounded-full bg-violet-500/10 px-1.5 text-violet-700 dark:text-violet-300">{drafts.length}</span>}
        <span className="text-emerald-600 dark:text-emerald-400">+{file.additions}</span>
        <span className="text-red-600 dark:text-red-400">−{file.deletions}</span>
      </button>
      {open &&
        (lines.length === 0 ? (
          <p className="px-3 py-2 text-xs text-muted-foreground">{file.status === "removed" ? "File removed." : "No text diff (binary or too large)."}</p>
        ) : (
          <div className="overflow-x-auto font-mono text-xs leading-5">
            {lines.map((l, i) => {
              const t = commentTarget(l);
              const k = t ? key({ path: file.path, ...t }) : undefined;
              const draft = k ? byKey.get(k) : undefined;
              return (
                <div key={i}>
                  <Line line={l} canComment={canComment && Boolean(t)} onComment={() => k && onEdit(k)} />
                  {t && (draft || editing === k) && (
                    <LineComment
                      value={draft?.body ?? ""}
                      autoFocus={editing === k}
                      onChange={(body) => setBody({ path: file.path, ...t, body }, body)}
                      onRemove={() => {
                        if (draft) remove(draft);
                        onEdit(undefined);
                      }}
                    />
                  )}
                </div>
              );
            })}
          </div>
        ))}
    </div>
  );
}

function Line({ line, canComment, onComment }: { line: DiffLine; canComment: boolean; onComment: () => void }) {
  if (line.kind === "hunk") return <div className="bg-sky-500/5 px-3 text-muted-foreground">{line.text}</div>;
  return (
    <div className={cn("group/line flex min-w-max", line.kind === "add" && "bg-emerald-500/10", line.kind === "del" && "bg-red-500/10")}>
      <span className="w-10 shrink-0 select-none pr-1 text-right text-muted-foreground/70">{line.oldLine ?? ""}</span>
      <span className="w-10 shrink-0 select-none pr-1 text-right text-muted-foreground/70">{line.newLine ?? ""}</span>
      <span className="relative w-5 shrink-0 select-none text-center text-muted-foreground">
        {canComment ? (
          <button
            type="button"
            aria-label="Comment on this line"
            onClick={onComment}
            className="absolute inset-0 hidden items-center justify-center rounded bg-violet-600 text-white group-hover/line:flex"
          >
            <MessageSquarePlus className="size-3" />
          </button>
        ) : null}
        {line.kind === "add" ? "+" : line.kind === "del" ? "−" : " "}
      </span>
      <span className="whitespace-pre pr-4">{line.text}</span>
    </div>
  );
}

function LineComment({ value, autoFocus, onChange, onRemove }: { value: string; autoFocus: boolean; onChange: (v: string) => void; onRemove: () => void }) {
  return (
    <div className="flex items-start gap-2 border-y bg-background px-3 py-2 font-sans">
      <textarea
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        rows={2}
        placeholder="Comment on this line; it is sent with your review"
        className="min-w-0 flex-1 resize-y rounded-md border bg-background p-2 text-sm outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring/30 dark:bg-transparent"
      />
      <button
        type="button"
        aria-label="Remove comment"
        onClick={onRemove}
        className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
