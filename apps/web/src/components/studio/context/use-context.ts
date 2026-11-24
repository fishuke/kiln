"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ContextBrief, StudioContextClient } from "@/lib/studio/client";
import type { ContextSnapshot, Preview } from "@/lib/studio/types";

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Everything about a Context that is not the document, kept current. */
export function useContextSnapshot(ctx: StudioContextClient, appId: string) {
  const [snap, setSnap] = useState<ContextSnapshot>();
  const [error, setError] = useState<string>();
  const reload = useRef<() => void>(() => undefined);
  useEffect(() => {
    let stop = false;
    let seq = 0;
    const load = () => {
      const mine = (seq += 1);
      return ctx.snapshot(appId).then(
        (s) => {
          // An answer that comes back after a newer one was asked for is out of date.
          if (stop || mine !== seq) return;
          setSnap(s);
          setError(undefined);
        },
        (err: unknown) => !stop && mine === seq && setError(message(err)),
      );
    };
    reload.current = () => void load();
    void load();
    const off = ctx.subscribe(appId, () => void load());
    return () => {
      stop = true;
      off();
    };
  }, [ctx, appId]);
  /** Asks again now: after the person did something, so the page doesn't wait for the server to say so. */
  const refresh = useCallback(() => reload.current(), []);
  return { snap, error, refresh };
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
