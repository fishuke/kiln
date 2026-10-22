"use client";

import Link from "next/link";
import { ExternalLink, FileDiff, GitPullRequest } from "lucide-react";
import { useEffect, useState } from "react";
import { personName } from "@/components/kiln/run-visuals";
import { AppAvatar } from "@/components/studio/top-bar";
import { useStudioClient } from "@/components/studio/use-client";
import type { StudioReview } from "@/lib/studio/types";

function ExtLink({ href, children }: { href?: string; children: React.ReactNode }) {
  if (!href) return null;
  return (
    <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
      {children}
    </a>
  );
}

/** Studio pull requests the merge gate sent to review: the App, author, summary, the gate's reasons and links. */
export function StudioReviews({ fake }: { fake: boolean }) {
  const client = useStudioClient(fake);
  const [items, setItems] = useState<StudioReview[]>([]);
  useEffect(() => {
    const load = () => void client.reviews().then(setItems, () => undefined);
    load();
    const off = client.subscribe?.(load);
    const t = setInterval(load, 8000);
    return () => {
      clearInterval(t);
      off?.();
    };
  }, [client]);
  if (!items.length) return null;
  return (
    <section aria-label="Studio pull requests" className="mx-2 mt-2 flex flex-col gap-2">
      {items.map(({ pullRequest: pr, app, title }) => (
        <article key={pr.id} className="rounded-lg border p-3">
          <div className="flex items-start gap-3">
            <AppAvatar name={app.name} className="mt-0.5 size-6" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 text-sm">
                <Link href={`/studio/${app.id}`} className="font-medium hover:underline">
                  {app.name}
                </Link>
                <span className="text-muted-foreground">
                  #{pr.number} · {personName(pr.createdBy)}
                </span>
                <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300">
                  Waiting for review
                </span>
              </div>
              <div className="mt-0.5 text-sm">{title}</div>
              {pr.reasons?.length ? (
                <ul className="mt-2 list-disc space-y-0.5 pl-4 text-sm text-muted-foreground">
                  {pr.reasons.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              ) : null}
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                <ExtLink href={`${pr.url}/files`}>
                  <FileDiff className="size-3.5" />
                  Diff
                </ExtLink>
                <ExtLink href={pr.url}>
                  <GitPullRequest className="size-3.5" />
                  {pr.repo}#{pr.number}
                </ExtLink>
                <ExtLink href={pr.builtInPreview}>
                  <ExternalLink className="size-3.5" />
                  Built-in preview
                </ExtLink>
                <ExtLink href={pr.previewUrl}>
                  <ExternalLink className="size-3.5" />
                  Deployment preview
                </ExtLink>
              </div>
            </div>
          </div>
        </article>
      ))}
    </section>
  );
}
