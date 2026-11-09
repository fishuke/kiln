import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileStore, SqliteStore } from "@kiln/store";
import { openRuntimeStore } from "./runtime-store";

const dirs: string[] = [];
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "kiln-runtime-store-"));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const legacy = { factories: { f1: { id: "f1", name: "Factory" } }, runs: { r1: { id: "r1", status: "succeeded" }, r2: { id: "r2", status: "running" } } };

describe("openRuntimeStore", () => {
  it("uses SQLite at kiln.db by default", () => {
    const dir = tempDir();
    const store = openRuntimeStore(dir, {});
    expect(store).toBeInstanceOf(SqliteStore);
    store.put("runs", { id: "r1" });
    expect(existsSync(join(dir, "kiln.db"))).toBe(true);
    expect(existsSync(join(dir, "kiln.json"))).toBe(false);
  });

  it("imports an existing kiln.json once and renames it", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "kiln.json"), JSON.stringify(legacy));
    const store = openRuntimeStore(dir, {});
    expect(store.get("factories", "f1")).toEqual({ id: "f1", name: "Factory" });
    expect(store.list("runs").map((r) => (r as { id: string }).id).sort()).toEqual(["r1", "r2"]);
    expect(existsSync(join(dir, "kiln.json"))).toBe(false);
    expect(existsSync(join(dir, "kiln.json.imported"))).toBe(true);

    store.delete("runs", "r2");
    // A kiln.json that shows up again next to kiln.db is left alone.
    writeFileSync(join(dir, "kiln.json"), JSON.stringify(legacy));
    const again = openRuntimeStore(dir, {});
    expect(again.list("runs")).toEqual([{ id: "r1", status: "succeeded" }]);
    expect(existsSync(join(dir, "kiln.json"))).toBe(true);
  });

  it("keeps the JSON file with KILN_STORE=file", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "kiln.json"), JSON.stringify(legacy));
    const store = openRuntimeStore(dir, { KILN_STORE: "file" });
    expect(store).toBeInstanceOf(FileStore);
    expect(store.get("factories", "f1")).toEqual({ id: "f1", name: "Factory" });
    expect(existsSync(join(dir, "kiln.db"))).toBe(false);
  });

  it("rejects an unknown KILN_STORE", () => {
    expect(() => openRuntimeStore(tempDir(), { KILN_STORE: "postgres" })).toThrow(/KILN_STORE/);
  });
});
