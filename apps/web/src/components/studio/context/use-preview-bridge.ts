"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { dueHighlight, readFrameMessage, sendToFrame, type PendingHighlight } from "@/lib/studio/preview-bridge";

/**
 * The page's end of the prototype bridge: tells the frame to outline a fragment's elements, and
 * in inspect mode hears which fragment the person clicked. `ready` stays false for a prototype
 * whose App has no bridge (an older template, an imported App), and then nothing is sent.
 */
export function usePreviewBridge({ route, onPick }: { route: string; onPick: (fragment: string) => void }) {
  const frame = useRef<Window | null>(null);
  const pending = useRef<PendingHighlight | undefined>(undefined);
  const [ready, setReady] = useState(false);
  const [inspecting, setInspecting] = useState(false);
  // The message listener reads these without being attached again on every change.
  const state = useRef({ ready, inspecting, route, onPick });
  state.current = { ready, inspecting, route, onPick };

  /** For `PreviewPane`: the frame's window, null when the frame goes away. A new frame has to say it is ready again. */
  const onFrame = useCallback((win: Window | null) => {
    if (frame.current === win) return;
    frame.current = win;
    setReady(false);
    setInspecting(false);
  }, []);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const message = readFrameMessage(event, frame.current);
      if (!message) return;
      if (message.type === "kiln:ready") {
        setReady(true);
        // The frame's page loaded (again): it has forgotten inspect mode, and may be the route a highlight waits for.
        if (state.current.inspecting) sendToFrame(frame.current, { type: "kiln:inspect", on: true });
        const fragment = dueHighlight(pending.current, Date.now());
        pending.current = undefined;
        if (fragment) sendToFrame(frame.current, { type: "kiln:highlight", fragment });
      } else if (state.current.inspecting) {
        setInspecting(false);
        sendToFrame(frame.current, { type: "kiln:inspect", on: false });
        state.current.onPick(message.fragment);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const setInspect = useCallback((on: boolean) => {
    if (!state.current.ready) return;
    setInspecting(on);
    sendToFrame(frame.current, { type: "kiln:inspect", on });
  }, []);

  /** Outline a fragment's elements on `onRoute`: now when the frame shows that route, else once it has loaded it. */
  const highlight = useCallback((fragment: string, onRoute: string) => {
    if (state.current.ready && onRoute === state.current.route) sendToFrame(frame.current, { type: "kiln:highlight", fragment });
    else pending.current = { fragment, at: Date.now() };
  }, []);

  return { onFrame, ready, inspecting, setInspect, highlight };
}
