import { applyAwarenessUpdate, Awareness, encodeAwarenessUpdate, removeAwarenessStates } from "y-protocols/awareness";
import * as Y from "yjs";

/** A Yjs document with its awareness, however it is synced. `synced` resolves once peers (if any) have answered. */
export type ContextProvider = { doc: Y.Doc; awareness: Awareness; synced: Promise<void>; peers(): number; destroy(): void };

type Message =
  | { t: "hello"; sv: Uint8Array; reply: boolean }
  | { t: "update"; u: Uint8Array; sync?: boolean }
  | { t: "awareness"; u: Uint8Array }
  | { t: "awareness-query" };

/**
 * Syncs a Y.Doc between the browser tabs of one origin over a BroadcastChannel: what the fake uses
 * so two tabs show the same Context with no server. With `channel: false` (tests, no browser) the
 * document is local only.
 */
export function broadcastProvider(name: string, opts: { channel?: boolean; waitMs?: number } = {}): ContextProvider {
  const doc = new Y.Doc();
  const awareness = new Awareness(doc);
  const origin = { name };
  const channel = opts.channel !== false && typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(`kiln-studio-context:${name}`) : undefined;
  if (!channel) return { doc, awareness, synced: Promise.resolve(), peers: () => 0, destroy: () => doc.destroy() };

  const post = (m: Message) => channel.postMessage(m);
  let done!: () => void;
  const synced = new Promise<void>((resolve) => (done = resolve));
  const timer = setTimeout(done, opts.waitMs ?? 300);

  channel.onmessage = (e: MessageEvent<Message>) => {
    const m = e.data;
    if (m.t === "hello") {
      post({ t: "update", u: Y.encodeStateAsUpdate(doc, m.sv), sync: true });
      if (!m.reply) post({ t: "hello", sv: Y.encodeStateVector(doc), reply: true });
      post({ t: "awareness", u: encodeAwarenessUpdate(awareness, [...awareness.getStates().keys()]) });
    } else if (m.t === "update") {
      Y.applyUpdate(doc, m.u, origin);
      if (m.sync) done();
    } else if (m.t === "awareness") applyAwarenessUpdate(awareness, m.u, origin);
    else if (m.t === "awareness-query") post({ t: "awareness", u: encodeAwarenessUpdate(awareness, [doc.clientID]) });
  };
  const onUpdate = (u: Uint8Array, from: unknown) => {
    if (from !== origin) post({ t: "update", u });
  };
  const onAwareness = ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, from: unknown) => {
    if (from !== origin) post({ t: "awareness", u: encodeAwarenessUpdate(awareness, [...added, ...updated, ...removed]) });
  };
  doc.on("update", onUpdate);
  awareness.on("update", onAwareness);
  const leave = () => removeAwarenessStates(awareness, [doc.clientID], "leave");
  if (typeof window !== "undefined") window.addEventListener("pagehide", leave);
  post({ t: "hello", sv: Y.encodeStateVector(doc), reply: false });
  post({ t: "awareness-query" });

  return {
    doc,
    awareness,
    synced,
    peers: () => Math.max(0, awareness.getStates().size - (awareness.getLocalState() ? 1 : 0)),
    destroy: () => {
      clearTimeout(timer);
      leave();
      if (typeof window !== "undefined") window.removeEventListener("pagehide", leave);
      doc.off("update", onUpdate);
      awareness.off("update", onAwareness);
      channel.close();
      awareness.destroy();
      doc.destroy();
    },
  };
}
