# ADR-015: SQLite for runtime state

Status: Accepted · Date: 2026-11-09 · Supersedes: the `FileStore` part of ADR-005

## Context

ADR-005 kept runtime state in one JSON file (`FileStore`). Each write serializes the whole state and rewrites the file; real installs reach several MB, and two writers can lose each other's changes. The `Store` interface is synchronous and has about 300 call sites, so an async database (Postgres) needs a refactor first.

## Decision

Runtime state goes through the same `Store` interface into SQLite (`SqliteStore`) at `<dataDir>/kiln.db`, using Node's built-in synchronous `node:sqlite`. One table holds documents as JSON, keyed by collection and id, in WAL mode. `Store.transaction` maps to a SQLite transaction. On first start an existing `kiln.json` is imported once and renamed to `kiln.json.imported`. `FileStore` stays available with `KILN_STORE=file` for one release. Objects and events stay as ADR-005 describes.

## Consequences

- A write touches one row instead of the whole state; a crash mid-write leaves the database consistent.
- Still one process per data directory. Several API nodes or a managed database (Postgres on RDS) remain a follow-up behind an async `Store`.
- Backups need SQLite's own backup (`sqlite3 kiln.db ".backup …"`) or a stopped API; copying the directory while it runs can miss the WAL.
- Requires Node 22.13 or later (`node:sqlite` without a flag).
