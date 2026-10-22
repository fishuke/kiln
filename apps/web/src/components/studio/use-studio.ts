"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { StudioClient } from "@/lib/studio/client";
import type { ChatDetail, Preview, ProjectDetail, StatusReport } from "@/lib/studio/types";

/** How often the page polls the API: fast while something runs, slow otherwise. */
const FAST_MS = 2000;
const SLOW_MS = 8000;

export type PreviewTarget = { chatId: string } | { versionId: string };

/**
 * A project's live state: the project with its chats and versions, every loaded chat's turns, the
 * attention report, and a counter that bumps when a turn finishes (the preview reloads on it).
 */
export function useStudioProject(client: StudioClient, projectId: string) {
  const [detail, setDetail] = useState<ProjectDetail>();
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
    try {
      const [d, s] = await Promise.all([client.project(projectId), client.status().catch(() => undefined)]);
      setDetail(d);
      if (s) setStatus(s);
      setError(undefined);
      await Promise.all([...wanted.current].filter((id) => d.chats.some((c) => c.id === id)).map(loadChat));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [client, projectId, loadChat]);

  const busy = Boolean(detail && (detail.project.status === "creating" || detail.chats.some((c) => c.status === "working")));

  useEffect(() => {
    void refresh();
    const unsubscribe = client.subscribe?.(() => void refresh());
    const timer = setInterval(() => void refresh(), busy ? FAST_MS : SLOW_MS);
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
  }, [client, key, finished]);

  return { preview, error };
}
