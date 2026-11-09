import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import type { Store } from "./index";

/** Runtime state in SQLite (ADR-015): one row per document, JSON in a text column. Single process per file. */
export class SqliteStore implements Store {
  private readonly db: DatabaseSync;
  private readonly sql: Record<"get" | "put" | "delete" | "list", StatementSync>;
  private depth = 0;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS documents (
        collection TEXT NOT NULL,
        id TEXT NOT NULL,
        json TEXT NOT NULL,
        PRIMARY KEY (collection, id)
      ) WITHOUT ROWID;
    `);
    this.sql = {
      get: this.db.prepare("SELECT json FROM documents WHERE collection = ? AND id = ?"),
      put: this.db.prepare("INSERT INTO documents (collection, id, json) VALUES (?, ?, ?) ON CONFLICT (collection, id) DO UPDATE SET json = excluded.json"),
      delete: this.db.prepare("DELETE FROM documents WHERE collection = ? AND id = ?"),
      list: this.db.prepare("SELECT json FROM documents WHERE collection = ?"),
    };
  }

  get<T extends { id: string }>(collection: string, id: string): T | undefined {
    const row = this.sql.get.get(collection, id) as { json: string } | undefined;
    return row ? (JSON.parse(row.json) as T) : undefined;
  }

  put<T extends { id: string }>(collection: string, doc: T): T {
    this.sql.put.run(collection, doc.id, JSON.stringify(doc));
    return doc;
  }

  delete(collection: string, id: string): boolean {
    return Number(this.sql.delete.run(collection, id).changes) > 0;
  }

  list<T extends { id: string }>(collection: string, filter?: (doc: T) => boolean): T[] {
    const docs = (this.sql.list.all(collection) as { json: string }[]).map((r) => JSON.parse(r.json) as T);
    return filter ? docs.filter(filter) : docs;
  }

  /** BEGIN … COMMIT; a nested call uses a savepoint so an inner failure undoes only its own writes. */
  transaction<R>(fn: (store: Store) => R): R {
    const savepoint = `sp${this.depth}`;
    this.db.exec(this.depth === 0 ? "BEGIN IMMEDIATE" : `SAVEPOINT ${savepoint}`);
    this.depth++;
    try {
      const result = fn(this);
      this.depth--;
      this.db.exec(this.depth === 0 ? "COMMIT" : `RELEASE ${savepoint}`);
      return result;
    } catch (err) {
      this.depth--;
      this.db.exec(this.depth === 0 ? "ROLLBACK" : `ROLLBACK TO ${savepoint}; RELEASE ${savepoint}`);
      throw err;
    }
  }

  /** Write many documents in one transaction (used to import a `kiln.json`). */
  importAll(data: Record<string, Record<string, { id: string }>>): number {
    let count = 0;
    this.transaction(() => {
      for (const [collection, docs] of Object.entries(data)) {
        for (const doc of Object.values(docs)) {
          this.put(collection, doc);
          count++;
        }
      }
    });
    return count;
  }

  close(): void {
    this.db.close();
  }
}
