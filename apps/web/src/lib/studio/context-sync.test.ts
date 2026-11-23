import { afterEach, describe, expect, it } from "vitest";
import { broadcastProvider, type ContextProvider } from "./context-sync";

const open: ContextProvider[] = [];
const tab = (name: string, opts: { channel?: boolean } = {}) => {
  const p = broadcastProvider(name, { waitMs: 50, ...opts });
  open.push(p);
  return p;
};
const settle = () => new Promise((r) => setTimeout(r, 30));

afterEach(() => {
  for (const p of open.splice(0)) p.destroy();
});

describe("broadcastProvider: one Context in two tabs", () => {
  it("shows what one tab writes in the other", async () => {
    const a = tab("sync-1");
    const b = tab("sync-1");
    await Promise.all([a.synced, b.synced]);
    a.doc.getMap("meta").set("version", 3);
    a.doc.getXmlFragment("context");
    b.doc.getText("t").insert(0, "from b");
    await settle();
    expect(b.doc.getMap("meta").get("version")).toBe(3);
    expect(a.doc.getText("t").toString()).toBe("from b");
  });

  it("gives a tab that opens later what is already there", async () => {
    const a = tab("sync-2");
    await a.synced;
    a.doc.getText("t").insert(0, "written before b opened");
    const b = tab("sync-2");
    await b.synced;
    expect(b.doc.getText("t").toString()).toBe("written before b opened");
  });

  it("shares presence, and drops it when a tab closes", async () => {
    const a = tab("sync-3");
    const b = tab("sync-3");
    a.awareness.setLocalStateField("user", { name: "Ada", color: "#059669" });
    b.awareness.setLocalStateField("user", { name: "Sam", color: "#2563eb" });
    await settle();
    const names = (p: ContextProvider) => [...p.awareness.getStates().values()].map((s) => (s as { user?: { name: string } }).user?.name).sort();
    expect(names(a)).toEqual(["Ada", "Sam"]);
    expect(a.peers()).toBe(1);
    open.splice(open.indexOf(b), 1)[0]!.destroy();
    await settle();
    expect(names(a)).toEqual(["Ada"]);
  });

  it("keeps Contexts with different names apart, and stays local without a channel", async () => {
    const a = tab("sync-4");
    const other = tab("sync-5");
    const local = tab("sync-4", { channel: false });
    a.doc.getText("t").insert(0, "only here");
    await settle();
    expect(other.doc.getText("t").toString()).toBe("");
    expect(local.doc.getText("t").toString()).toBe("");
    expect(local.peers()).toBe(0);
  });
});
