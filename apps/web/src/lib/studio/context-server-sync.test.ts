import { applyAwarenessUpdate, Awareness, encodeAwarenessUpdate } from "y-protocols/awareness";
import { afterEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { serverProvider, type ServerSync, type SyncIO } from "./context-server-sync";

const b64 = (u: Uint8Array) => Buffer.from(u).toString("base64");
const bytes = (s: string) => new Uint8Array(Buffer.from(s, "base64"));

/** The API's side of the sync, as its routes behave: a document, presence, and a stream per page. */
function server(opts: { viewer?: boolean } = {}) {
  const doc = new Y.Doc();
  const awareness = new Awareness(doc);
  awareness.setLocalState(null);
  const streams = new Set<(event: string, data: string) => void>();
  const posts: { update?: string; awareness?: string; client?: string }[] = [];
  const send = (event: string, data: unknown) => streams.forEach((s) => s(event, JSON.stringify(data)));
  const io: SyncIO = {
    open(_url, on) {
      streams.add(on);
      on("state", JSON.stringify({ update: b64(Y.encodeStateAsUpdate(doc)), awareness: b64(encodeAwarenessUpdate(awareness, [...awareness.getStates().keys()])) }));
      return () => void streams.delete(on);
    },
    async post(_url, body) {
      const b = body as { update?: string; awareness?: string; client?: string };
      posts.push(b);
      if (b.update) {
        if (opts.viewer) return 403;
        Y.applyUpdate(doc, bytes(b.update));
        send("update", { u: b.update, from: b.client });
      }
      if (b.awareness) {
        applyAwarenessUpdate(awareness, bytes(b.awareness), "page");
        send("awareness", { u: b.awareness, from: b.client });
      }
      return 200;
    },
  };
  return { doc, awareness, io, posts, send, streams };
}

const open: ServerSync[] = [];
const page = (io: SyncIO) => {
  const p = serverProvider("sa_1", io, { update: 5, presence: 5 });
  open.push(p);
  return p;
};
const settle = () => new Promise((r) => setTimeout(r, 30));
afterEach(() => {
  for (const p of open.splice(0)) p.destroy();
});

describe("the Context document from the API", () => {
  it("starts from the server's state and sends the page's own changes up, a few at a time", async () => {
    const s = server();
    s.doc.getText("t").insert(0, "from the server");
    const p = page(s.io);
    await p.synced;
    expect(p.doc.getText("t").toString()).toBe("from the server");
    p.doc.getText("t").insert(0, "a");
    p.doc.getText("t").insert(1, "b");
    p.doc.getText("t").insert(2, "c ");
    await settle();
    expect(s.doc.getText("t").toString()).toBe("abc from the server");
    expect(s.posts.filter((x) => x.update)).toHaveLength(1);
    expect(s.posts[0]!.client).toBe(String(p.doc.clientID));
  });

  it("shows another page's changes and presence, and doesn't send them back", async () => {
    const s = server();
    const a = page(s.io);
    const b = page(s.io);
    await Promise.all([a.synced, b.synced]);
    a.awareness.setLocalStateField("user", { name: "Ada" });
    a.doc.getText("t").insert(0, "hello");
    await settle();
    expect(b.doc.getText("t").toString()).toBe("hello");
    expect([...b.awareness.getStates().values()].map((x) => (x as { user?: { name: string } }).user?.name)).toContain("Ada");
    expect(b.peers()).toBe(1);
    expect(s.posts.filter((x) => x.update).every((x) => x.client === String(a.doc.clientID))).toBe(true);
  });

  it("tells the page when the server says the rest changed", async () => {
    const s = server();
    const p = page(s.io);
    await p.synced;
    let n = 0;
    const off = p.onChanged(() => (n += 1));
    s.send("changed", {});
    expect(n).toBe(1);
    off();
    s.send("changed", {});
    expect(n).toBe(1);
  });

  it("after a reconnect, sends what the server is missing", async () => {
    const s = server();
    const p = page(s.io);
    await p.synced;
    p.doc.getText("t").insert(0, "kept");
    await settle();
    // The server lost the page's last change (a restart before it was saved) and the stream comes back.
    const restarted = new Y.Doc();
    const again = [...s.streams][0]!;
    again("state", JSON.stringify({ update: b64(Y.encodeStateAsUpdate(restarted)), awareness: b64(encodeAwarenessUpdate(s.awareness, [])) }));
    await settle();
    const resent = s.posts.filter((x) => x.update).at(-1)!;
    Y.applyUpdate(restarted, bytes(resent.update!));
    expect(restarted.getText("t").toString()).toBe("kept");
  });

  it("stops sending document changes once the server refuses them (a viewer), but keeps presence", async () => {
    const s = server({ viewer: true });
    const p = page(s.io);
    await p.synced;
    p.doc.getText("t").insert(0, "x");
    await settle();
    p.doc.getText("t").insert(1, "y");
    p.awareness.setLocalStateField("user", { name: "Sam" });
    await settle();
    expect(s.posts.filter((x) => x.update)).toHaveLength(1);
    expect(s.posts.some((x) => x.awareness)).toBe(true);
    expect(s.doc.getText("t").toString()).toBe("");
  });
});
