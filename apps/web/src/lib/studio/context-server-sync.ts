/**
 * An App's Context document from the API (ADR-019, Transport), with no browser needed to test it:
 * the stream and the POST come in through `io`.
 */
import { applyAwarenessUpdate, Awareness, encodeAwarenessUpdate, removeAwarenessStates } from "y-protocols/awareness";
import * as Y from "yjs";
import type { ContextProvider } from "./context-sync";

/** The server's event stream and the POST, as the browser has them. */
export type SyncIO = {
  /** Opens the stream; `on(event, data)` gets each event's JSON. Returns a function that closes it. */
  open(url: string, on: (event: string, data: string) => void, closed: () => void): () => void;
  /** Sends a body; resolves with the HTTP status, or undefined when it couldn't be sent. */
  post(url: string, body: unknown): Promise<number | undefined>;
};

export const browserIO: SyncIO = {
  open(url, on, closed) {
    const stream = new EventSource(url);
    for (const event of ["state", "update", "awareness", "changed"]) stream.addEventListener(event, (e) => on(event, (e as MessageEvent<string>).data));
    stream.onerror = () => stream.readyState === EventSource.CLOSED && closed();
    return () => stream.close();
  },
  post: (url, body) =>
    fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), keepalive: true }).then(
      (res) => res.status,
      () => undefined,
    ),
};

export type ServerSync = ContextProvider & { onChanged(cb: () => void): () => void };

const b64 = (bytes: Uint8Array) => {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const bytes = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

/**
 * An App's Context document from the API (ADR-019, Transport): the server's event stream brings its
 * state and every later change; the page's own changes go up in a POST, a few at a time. The stream
 * reconnects by itself, and each time it does the page sends what the server is missing.
 */
export function serverProvider(appId: string, io: SyncIO = browserIO, wait = { update: 40, presence: 120 }): ServerSync {
  const doc = new Y.Doc();
  const awareness = new Awareness(doc);
  const REMOTE = { server: appId };
  const client = `${doc.clientID}`;
  const url = `/api/studio/apps/${encodeURIComponent(appId)}/context/sync`;
  const changed = new Set<() => void>();
  let done!: () => void;
  const synced = new Promise<void>((resolve) => (done = resolve));
  let readOnly = false;

  const post = (body: { update?: string; awareness?: string }) =>
    io.post(url, { ...body, client }).then((status) => {
      // A viewer's document updates are refused; the page already keeps them from editing.
      if (status === 403 && body.update) readOnly = true;
    });

  let pending: Uint8Array[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flush = () => {
    timer = undefined;
    if (!pending.length) return;
    const update = pending.length === 1 ? pending[0]! : Y.mergeUpdates(pending);
    pending = [];
    void post({ update: b64(update) });
  };
  const onUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === REMOTE || readOnly) return;
    pending.push(update);
    timer ??= setTimeout(flush, wait.update);
  };
  let presence: ReturnType<typeof setTimeout> | undefined;
  const touched = new Set<number>();
  const onAwareness = ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
    if (origin === REMOTE) return;
    for (const id of [...added, ...updated, ...removed]) touched.add(id);
    presence ??= setTimeout(() => {
      presence = undefined;
      const ids = [...touched];
      touched.clear();
      void post({ awareness: b64(encodeAwarenessUpdate(awareness, ids)) });
    }, wait.presence);
  };
  doc.on("update", onUpdate);
  awareness.on("update", onAwareness);

  const close = io.open(
    `${url}?awareness=${doc.clientID}`,
    (event, raw) => {
      if (event === "state") {
        const s = JSON.parse(raw) as { update: string; awareness: string };
        const theirs = bytes(s.update);
        Y.applyUpdate(doc, theirs, REMOTE);
        applyAwarenessUpdate(awareness, bytes(s.awareness), REMOTE);
        // After a reconnect: whatever the page has that the server doesn't, and the page's presence again.
        const missing = Y.encodeStateAsUpdate(doc, Y.encodeStateVectorFromUpdate(theirs));
        if (missing.length > 2 && !readOnly) void post({ update: b64(missing) });
        if (awareness.getLocalState()) void post({ awareness: b64(encodeAwarenessUpdate(awareness, [doc.clientID])) });
        done();
      } else if (event === "update" || event === "awareness") {
        const m = JSON.parse(raw) as { u: string; from?: string };
        if (m.from === client) return;
        if (event === "update") Y.applyUpdate(doc, bytes(m.u), REMOTE);
        else applyAwarenessUpdate(awareness, bytes(m.u), REMOTE);
        return;
      }
      for (const cb of [...changed]) cb();
    },
    // An App the caller can't open never syncs: let the page show its own error instead of waiting.
    done,
  );

  return {
    doc,
    awareness,
    synced,
    peers: () => Math.max(0, awareness.getStates().size - (awareness.getLocalState() ? 1 : 0)),
    onChanged(cb) {
      changed.add(cb);
      return () => changed.delete(cb);
    },
    destroy() {
      if (timer) clearTimeout(timer);
      if (presence) clearTimeout(presence);
      flush();
      removeAwarenessStates(awareness, [doc.clientID], "leave");
      close();
      doc.off("update", onUpdate);
      awareness.off("update", onAwareness);
      awareness.destroy();
      doc.destroy();
    },
  };
}
