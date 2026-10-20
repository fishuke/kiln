"use client";

import { toast } from "sonner";

type Result = { ok: true; applied?: string; pullRequest?: string } | { ok: false; error: string; errors?: string[] };

/** Toast a definition write: applied, pull request opened, or the validation errors. Returns ok. */
export function toastResult(r: Result, done: string): boolean {
  if (!r.ok) {
    toast.error(r.error, r.errors && r.errors.length > 1 ? { description: r.errors.slice(1, 4).join("\n") } : undefined);
    return false;
  }
  if (r.pullRequest) {
    const url = r.pullRequest;
    toast.success("Pull request opened", { description: "This factory is defined in a repository; merge the PR to apply.", action: { label: "Open", onClick: () => window.open(url, "_blank", "noopener") } });
  } else toast.success(done);
  return true;
}
