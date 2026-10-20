# ADR-005: Storage and events for a single-node v1

Status: Accepted (deviates from Postgres + NATS in PLAN.md for v1) · Date: 2026-10-20

## Context
PLAN.md lists Postgres, NATS JetStream and S3/MinIO. A self-hosted v1 should start with one process and a data directory.

## Decision
Runtime state goes through the `Store` interface (`MemoryStore` for tests, `FileStore` writing one JSON file atomically). Objects (videos, snapshots, reports) go through `ObjectStore` (`FileObjectStore`). Events go through an in-process bus that keeps an outbox. Definitions stay in Git or in the store by content hash; runtime state never stores definitions as truth.

## Consequences
- Simple backups: copy the data directory.
- Postgres, S3 and NATS implementations are follow-ups behind the same interfaces; the interfaces are synchronous today, so the Postgres store needs an async refactor first.
