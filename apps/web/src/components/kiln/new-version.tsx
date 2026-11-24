"use client";

import { useEffect } from "react";
import { toast } from "sonner";

const KEY = "kiln-reloaded-for-new-version";
const AGAIN_AFTER_MS = 30_000;

/**
 * After a deploy, a page loaded from the previous build calls server actions the new server doesn't
 * have; Next answers with `x-nextjs-action-not-found: 1`. The page then reloads onto the new build
 * instead of showing "Server Action … was not found". If it reloaded for this a moment ago (so a
 * reload didn't help), it asks instead of reloading in a loop.
 */
export function NewVersion() {
  useEffect(() => {
    const original = window.fetch;
    let handled = false;
    window.fetch = async (...args) => {
      const res = await original(...args);
      if (!handled && res.headers.get("x-nextjs-action-not-found") === "1") {
        handled = true;
        let recent = false;
        try {
          recent = Date.now() - Number(sessionStorage.getItem(KEY) ?? 0) < AGAIN_AFTER_MS;
          sessionStorage.setItem(KEY, String(Date.now()));
        } catch {
          /* storage blocked */
        }
        if (recent) toast("Kiln was updated", { description: "Reload the page to use the new version.", action: { label: "Reload", onClick: () => window.location.reload() }, duration: Infinity });
        else window.location.reload();
      }
      return res;
    };
    return () => {
      window.fetch = original;
    };
  }, []);
  return null;
}
