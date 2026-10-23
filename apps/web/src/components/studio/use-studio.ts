"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { StudioClient } from "@/lib/studio/client";
import type { ChatDetail, Preview, AppDetail, StatusReport } from "@/lib/studio/types";

/** How often the page polls the API: fast while something runs, slow otherwise. */
const FAST_MS = 2000;
const SLOW_MS = 8000;

export type PreviewTarget = { chatId: string } | { versionId: string };

/**
 * An app's live state: the app with its chats and versions, every loaded chat's turns, the
 * attention report, and a counter that bumps when a turn finishes (the preview reloads on it).
 */
export function useStudioApp(client: StudioClient, appId: string) {
  const [detail, setDetail] = useState<AppDetail>();
  const [chats, setChats] = useState<Record<string, ChatDetail>>({});
  const [status, setStatus] = useState<StatusReport>();
  const [error, setError] = useState<string>();
  const [finished, setFinished] = useState(0);
  const wanted = useRef(new Set<string>());
  const running = useRef(new Set<string>());

  const loadChat = useCallback(
    async (chatId: string) => {
      wanted.current.add(chatId);
      const c = await client.chat(chatId).catch(() => undefined);
      if (!c) return;
      const isRunning = c.turns.some((t) => t.status === "running");
      if (running.current.has(chatId) && !isRunning) setFinished((n) => n + 1);
      if (isRunning) running.current.add(chatId);
      else running.current.delete(chatId);
      setChats((prev) => ({ ...prev, [chatId]: c }));
    },
    [client],
  );

  const refresh = useCallback(async () => {
    // The attention report is slower and secondary: the app shows without waiting for it.
    void client.status().then(setStatus, () => undefined);
    try {
      const d = await client.app(appId);
      setDetail(d);
      setError(undefined);
      await Promise.all([...wanted.current].filter((id) => d.chats.some((c) => c.id === id)).map(loadChat));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [client, appId, loadChat]);

  const busy = Boolean(detail && (detail.app.status === "creating" || detail.chats.some((c) => c.status === "working")));

  useEffect(() => {
    void refresh();
    const unsubscribe = client.subscribe?.(() => void refresh());
    const timer = setInterval(() => void refresh(), busy && !client.watchChat ? FAST_MS : SLOW_MS);
    return () => {
      clearInterval(timer);
      unsubscribe?.();
    };
  }, [client, refresh, busy]);

  return { detail, chats, status, error, finished, refresh, loadChat };
}

/** The preview for a chat or a version; asks again while it is starting and after a turn finishes. */
export function usePreview(client: StudioClient, target: PreviewTarget | undefined, finished: number) {
  const [preview, setPreview] = useState<Preview>();
  const [error, setError] = useState<string>();
  const key = target ? ("chatId" in target ? `c:${target.chatId}` : `v:${target.versionId}`) : "";
  const shown = useRef("");
  // Bumps after a restart, so the preview is polled again while it starts.
  const [restarted, setRestarted] = useState(0);

  useEffect(() => {
    if (!target) {
      setPreview(undefined);
      return;
    }
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const p = "chatId" in target ? await client.chatPreview(target.chatId) : await client.versionPreview(target.versionId);
        if (stop) return;
        setPreview(p);
        setError(undefined);
        if (p.status === "starting") timer = setTimeout(load, 1000);
      } catch (err) {
        if (!stop) setError(err instanceof Error ? err.message : String(err));
      }
    };
    if (shown.current !== key) setPreview(undefined);
    shown.current = key;
    void load();
    return () => {
      stop = true;
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` identifies `target`
  }, [client, key, finished, restarted]);

  /** Stops the target's dev server and starts it again (it reads the App's environment when it starts). */
  const restart = useCallback(async () => {
    if (!target) return;
    const p = "chatId" in target ? await client.restartChatPreview(target.chatId) : await client.restartVersionPreview(target.versionId);
    setPreview(p);
    setError(undefined);
    setRestarted((n) => n + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` identifies `target`
  }, [client, key]);

  return { preview, error, restart };
}
