import { existsSync, readFileSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { FileStore, SqliteStore, type Store } from "@kiln/store";

/**
 * The runtime store for a data directory (ADR-015): SQLite at `kiln.db`, importing a `kiln.json`
 * from an older install once. `KILN_STORE=file` keeps the JSON file for one release.
 */
export function openRuntimeStore(dataDir: string, env: { KILN_STORE?: string }): Store {
  const kind = env.KILN_STORE || "sqlite";
  const jsonPath = join(dataDir, "kiln.json");
  if (kind === "file") return new FileStore(jsonPath);
  if (kind !== "sqlite") throw new Error(`KILN_STORE must be "sqlite" or "file", got "${kind}"`);

  const dbPath = join(dataDir, "kiln.db");
  if (!existsSync(dbPath) && existsSync(jsonPath)) importJson(jsonPath, dbPath);
  const store = new SqliteStore(dbPath);
  return store;
}

/** Build the database next to `kiln.db` and move it into place, so a crash mid-import leaves no half-filled `kiln.db`. */
function importJson(jsonPath: string, dbPath: string): void {
  const tmp = `${dbPath}.importing`;
  for (const f of [tmp, `${tmp}-wal`, `${tmp}-shm`]) rmSync(f, { force: true });
  const data = JSON.parse(readFileSync(jsonPath, "utf8")) as Record<string, Record<string, { id: string }>>;
  const target = new SqliteStore(tmp);
  const count = target.importAll(data);
  target.close();
  renameSync(tmp, dbPath);
  renameSync(jsonPath, `${jsonPath}.imported`);
  console.log(`[kiln] imported ${count} documents from kiln.json into kiln.db (old file kept as kiln.json.imported)`);
}
