import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileStore, MemoryStore, SqliteStore, type Store } from "./index";

type Doc = { id: string; name: string; tags?: string[] };

const dirs: string[] = [];
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "kiln-store-"));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const kinds: { name: string; open: () => { store: Store; reopen?: () => Store } }[] = [
  { name: "MemoryStore", open: () => ({ store: new MemoryStore() }) },
  {
    name: "FileStore",
    open: () => {
      const path = join(tempDir(), "kiln.json");
      return { store: new FileStore(path), reopen: () => new FileStore(path) };
    },
  },
  {
    name: "SqliteStore",
    open: () => {
      const path = join(tempDir(), "kiln.db");
      return { store: new SqliteStore(path), reopen: () => new SqliteStore(path) };
    },
  },
];

describe.each(kinds)("Store contract: $name", ({ open }) => {
  it("puts, gets, lists and deletes documents per collection", () => {
    const { store } = open();
    store.put<Doc>("a", { id: "1", name: "one" });
    store.put<Doc>("a", { id: "2", name: "two" });
    store.put<Doc>("b", { id: "1", name: "other" });
    expect(store.get<Doc>("a", "1")).toEqual({ id: "1", name: "one" });
    expect(store.get<Doc>("a", "missing")).toBeUndefined();
    expect(store.list<Doc>("a").map((d) => d.id).sort()).toEqual(["1", "2"]);
    expect(store.list<Doc>("a", (d) => d.name === "two")).toEqual([{ id: "2", name: "two" }]);
    expect(store.list("empty")).toEqual([]);
    expect(store.delete("a", "1")).toBe(true);
    expect(store.delete("a", "1")).toBe(false);
    expect(store.get("a", "1")).toBeUndefined();
    expect(store.get<Doc>("b", "1")?.name).toBe("other");
  });

  it("replaces a document on put and returns copies", () => {
    const { store } = open();
    const doc: Doc = { id: "1", name: "one", tags: ["x"] };
    expect(store.put("a", doc)).toBe(doc);
    doc.tags!.push("mutated");
    const got = store.get<Doc>("a", "1")!;
    expect(got.tags).toEqual(["x"]);
    got.tags!.push("again");
    store.list<Doc>("a")[0]!.name = "changed";
    expect(store.get<Doc>("a", "1")).toEqual({ id: "1", name: "one", tags: ["x"] });
    store.put<Doc>("a", { id: "1", name: "new" });
    expect(store.get<Doc>("a", "1")).toEqual({ id: "1", name: "new" });
    expect(store.list("a")).toHaveLength(1);
  });

  it("keeps a transaction's writes and returns its result", () => {
    const { store } = open();
    const result = store.transaction((tx) => {
      tx.put<Doc>("a", { id: "1", name: "one" });
      tx.put<Doc>("a", { id: "2", name: "two" });
      return tx.list("a").length;
    });
    expect(result).toBe(2);
    expect(store.list("a")).toHaveLength(2);
  });

  it("keeps none of a failed transaction's writes", () => {
    const { store } = open();
    store.put<Doc>("a", { id: "1", name: "one" });
    expect(() =>
      store.transaction((tx) => {
        tx.put<Doc>("a", { id: "1", name: "changed" });
        tx.put<Doc>("a", { id: "2", name: "two" });
        tx.delete("a", "1");
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(store.list<Doc>("a")).toEqual([{ id: "1", name: "one" }]);
  });

  it("undoes only a failed nested transaction", () => {
    const { store } = open();
    store.transaction((tx) => {
      tx.put<Doc>("a", { id: "1", name: "outer" });
      try {
        tx.transaction((inner) => {
          inner.put<Doc>("a", { id: "2", name: "inner" });
          throw new Error("inner");
        });
      } catch {
        // swallowed on purpose
      }
      tx.put<Doc>("a", { id: "3", name: "after" });
    });
    expect(store.list<Doc>("a").map((d) => d.id).sort()).toEqual(["1", "3"]);
  });

  it("keeps documents across a reopen", () => {
    const { store, reopen } = open();
    if (!reopen) return;
    store.put<Doc>("a", { id: "1", name: "one" });
    store.transaction((tx) => tx.put<Doc>("a", { id: "2", name: "two" }));
    store.delete("a", "1");
    expect(reopen().list<Doc>("a")).toEqual([{ id: "2", name: "two" }]);
  });
});
