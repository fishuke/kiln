"use client";

import { useCallback, useTransition } from "react";
import { toast } from "sonner";

type Result<T> = { ok: true; message?: string; data?: T } | { ok: false; error: string };

/**
 * Calls a server action, toasts its message or error, and reports pending state.
 * Resolves to the result's data on success, undefined on failure.
 */
export function useAction() {
  const [pending, start] = useTransition();
  const run = useCallback(
    <T,>(fn: () => Promise<Result<T>>, opts: { success?: string; onSuccess?: (data: T | undefined) => void } = {}) =>
      new Promise<T | undefined>((resolve) => {
        start(async () => {
          try {
            const r = await fn();
            if (r.ok) {
              const msg = opts.success ?? r.message;
              if (msg) toast.success(msg);
              opts.onSuccess?.(r.data);
              resolve(r.data);
            } else {
              toast.error(r.error);
              resolve(undefined);
            }
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "Something went wrong");
            resolve(undefined);
          }
        });
      }),
    [],
  );
  return [pending, run] as const;
}
