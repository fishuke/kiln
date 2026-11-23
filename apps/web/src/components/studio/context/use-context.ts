"use client";

import { useEffect, useState } from "react";
import type { ContextBrief, StudioContextClient } from "@/lib/studio/client";
import type { ContextSnapshot, Preview } from "@/lib/studio/types";

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Everything about a Context that is not the document, kept current. */
export function useContextSnapshot(ctx: StudioContextClient, appId: string) {
  const [snap, setSnap] = useState<ContextSnapshot>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    let stop = false;
    const load = () =>
      ctx.snapshot(appId).then(
        (s) => {
          if (stop) return;
          setSnap(s);
          setError(undefined);
        },
        (err: unknown) => !stop && setError(message(err)),
      );
    void load();
    const off = ctx.subscribe(appId, () => void load());
    return () => {
      stop = true;
      off();
    };
  }, [ctx, appId]);
  return { snap, error };
}

/** The prototype's preview, asked again after each build and while it starts. */
export function useContextPreview(ctx: StudioContextClient, appId: string, builtVersion: number | undefined) {
  const [preview, setPreview] = useState<Preview>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (builtVersion === undefined) return setPreview(undefined);
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = () =>
      ctx.preview(appId).then(
        (p) => {
          if (stop) return;
          setPreview(p);
          setError(undefined);
          if (p.status === "starting") timer = setTimeout(load, 1000);
        },
        (err: unknown) => !stop && setError(message(err)),
      );
    void load();
    return () => {
      stop = true;
      if (timer) clearTimeout(timer);
    };
  }, [ctx, appId, builtVersion]);
  return { preview, error };
}

/** The Brief for the Context's current version. `ready` waits for the document, which the Brief is written from. */
export function useBrief(ctx: StudioContextClient, appId: string, version: number | undefined, ready: boolean) {
  const [brief, setBrief] = useState<ContextBrief>();
  useEffect(() => {
    if (!ready || version === undefined) return;
    let stop = false;
    ctx.brief(appId).then(
      (b) => !stop && setBrief(b),
      () => undefined,
    );
    return () => {
      stop = true;
    };
  }, [ctx, appId, version, ready]);
  return brief;
}
