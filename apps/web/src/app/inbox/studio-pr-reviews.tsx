import Link from "next/link";
import { ExternalLink, FileDiff, GitPullRequest } from "lucide-react";
import { personName } from "@/components/kiln/run-visuals";
import type { MergeReview } from "@/lib/studio/types";

export type StudioPrReview = { review: MergeReview; app?: { id: string; name: string } };

function Ext({ href, children }: { href?: string; children: React.ReactNode }) {
  if (!href) return null;
  return (
    <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
      {children}
    </a>
  );
}

/**
 * Inbox items of kind `studio_pr_review`: App pull requests the merge gate sent to a person, from
 * `GET /merge-gate/reviews?state=needs_review`, with the App, author, summary, the gate's reasons,
 * the previews and the pull request.
 */
export function StudioPrReviews({ items }: { items: StudioPrReview[] }) {
  if (!items.length) return null;
  return (
    <section aria-label="Studio pull requests to review" className="mx-2 mt-2 flex flex-col gap-2">
      {items.map(({ review: r, app }) => (
        <article key={r.id} className="rounded-lg border p-3">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            <GitPullRequest className="size-4 text-amber-600 dark:text-amber-400" />
            {app ? (
              <Link href={r.link ?? `/studio/${app.id}`} className="font-medium hover:underline">
                {app.name}
              </Link>
            ) : (
              <span className="font-medium">{r.repo}</span>
            )}
            <span className="text-muted-foreground">
              #{r.number} · {personName(r.author)}
            </span>
            <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300">
              Waiting for review
            </span>
          </div>
          <div className="mt-1 text-sm">{r.title}</div>
          {r.reasons.length > 0 && (
            <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm text-muted-foreground">
              {r.reasons.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          )}
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
            <Ext href={`${r.url}/files`}>
              <FileDiff className="size-3.5" />
              Diff
            </Ext>
            <Ext href={r.url}>
              <GitPullRequest className="size-3.5" />
              {r.repo}#{r.number}
            </Ext>
            {app && (
              <Link href={`/studio/${app.id}`} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                <ExternalLink className="size-3.5" />
                Built-in preview
              </Link>
            )}
            <Ext href={r.previewUrl}>
              <ExternalLink className="size-3.5" />
              Deployment preview
            </Ext>
          </div>
        </article>
      ))}
    </section>
  );
}
