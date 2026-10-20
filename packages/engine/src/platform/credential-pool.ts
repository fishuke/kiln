import type { UsageWindow } from "@kiln/harness";
import { KilnError } from "../errors";
import type { Kiln } from "../kiln";
import type { SecretMeta } from "./types";
import type { SecretScope } from "./vault";

export const CREDENTIAL_HEALTH = "credential_health";

/** unknown: not used since it was set; ok: last use worked; limited: a usage window is exhausted; invalid: the provider rejected it. */
export type CredentialStatus = "unknown" | "ok" | "limited" | "invalid";

type Health = {
  id: string;
  status: CredentialStatus;
  /** The secret version this record is about; a new value starts over. */
  secretUpdatedAt: string;
  fiveHour?: UsageWindow;
  sevenDay?: UsageWindow;
  /** Other windows by name, e.g. a model's own weekly limit (`seven_day_fable`). */
  others?: Record<string, UsageWindow>;
  /** When a limited token can be used again. */
  resetsAt?: string;
  error?: string;
  checkedAt?: string;
  lastUsedAt?: string;
};

export type PoolEntry = Omit<Health, "id" | "secretUpdatedAt"> & { name: string; scope: SecretMeta["scope"]; updatedAt: string };

/** Provider answers that mean the token itself is wrong, expired or revoked (not a busy or failing model). */
const AUTH_FAILURE =
  /\b401\b|authenticat|invalid (bearer|api key|x-api-key|token)|oauth token (has )?(expired|been revoked|revoked)|token (has )?(expired|been revoked)/i;
export const isAuthFailure = (text: string | undefined) => Boolean(text && AUTH_FAILURE.test(text));

const TYPE = "claude_oauth_token";
const key = (m: Pick<SecretMeta, "scope" | "owner" | "name">) => `${m.scope}:${m.owner}:${m.name}`;
const load = (e: PoolEntry) => Math.max(e.fiveHour?.utilization ?? 0, e.sevenDay?.utilization ?? 0);

/**
 * Several Claude subscription tokens (`claude setup-token`) for one team or person. Every run reports
 * the usage windows of the token it used; runs go to the usable token with the most left.
 */
export class CredentialPool {
  constructor(private readonly k: Kiln) {}

  /** Subscription tokens a run in this scope may use: the person's own, then the team's. */
  private candidates(scope: SecretScope): SecretMeta[] {
    return this.k.vault
      .list(scope)
      .filter((m) => m.type === TYPE)
      .sort((a, b) => (a.scope === b.scope ? a.name.localeCompare(b.name) : a.scope === "personal" ? -1 : 1));
  }

  private entry(m: SecretMeta): PoolEntry {
    const base = { name: m.name, scope: m.scope, updatedAt: m.updatedAt };
    const h = this.k.store.get<Health>(CREDENTIAL_HEALTH, key(m));
    if (!h || h.secretUpdatedAt !== m.updatedAt) return { ...base, status: "unknown", ...(h?.lastUsedAt ? { lastUsedAt: h.lastUsedAt } : {}) };
    const { id: _id, secretUpdatedAt: _version, ...rest } = h;
    // A limited token whose window has reset is worth trying again.
    if (h.status === "limited" && (!h.resetsAt || h.resetsAt <= this.now())) return { ...base, ...rest, status: "unknown" };
    return { ...base, ...rest };
  }

  list(teamId: string, userId?: string): PoolEntry[] {
    return this.candidates({ teamId, userId }).map((m) => this.entry(m));
  }

  /**
   * The token for the next run: usable ones (ok or unknown) by most headroom, then least recently used.
   * Undefined when the scope has no subscription tokens; an error when it has some but none is usable.
   */
  choose(scope: SecretScope): { name: string; env: Record<string, string> } | undefined {
    const all = this.candidates(scope).map((m) => ({ m, e: this.entry(m) }));
    if (!all.length) return undefined;
    const pick = all
      .filter(({ e }) => e.status === "ok" || e.status === "unknown")
      .sort((a, b) => load(a.e) - load(b.e) || (a.e.lastUsedAt ?? "").localeCompare(b.e.lastUsedAt ?? "") || a.m.name.localeCompare(b.m.name))[0];
    if (!pick) {
      const why = all
        .map(({ e }) => (e.status === "limited" ? `${e.name} is limited until ${e.resetsAt}` : `${e.name} is invalid (${e.error ?? "rejected"})`))
        .join("; ");
      throw new KilnError("integration_not_configured", `every Claude token is unusable: ${why}. Add a token or check them under Settings → Model keys.`, {
        integrationName: "claude-code",
      });
    }
    this.update(pick.m, (h) => ({ ...h, lastUsedAt: this.now() }));
    return { name: pick.m.name, env: this.k.vault.resolver(scope).envFor(pick.m.name) ?? {} };
  }

  /** A run's usage report for the token it used. */
  recordUsage(scope: SecretScope, name: string, report: { status: string; fiveHour?: UsageWindow; sevenDay?: UsageWindow; others?: Record<string, UsageWindow> }) {
    const m = this.meta(scope, name);
    if (!m) return;
    const limited = report.status !== "allowed" && report.status !== "allowed_warning";
    const exhausted = [report.fiveHour, report.sevenDay].flatMap((w) => (w && w.utilization >= 1 && w.resetsAt ? [w.resetsAt] : [])).sort();
    const resetsAt = limited ? (exhausted.at(-1) ?? report.fiveHour?.resetsAt) : undefined;
    this.update(m, (h) => ({
      ...h,
      status: limited ? "limited" : "ok",
      fiveHour: report.fiveHour,
      sevenDay: report.sevenDay,
      others: report.others,
      resetsAt,
      error: undefined,
      checkedAt: this.now(),
    }));
  }

  /** How a run with this token ended: an auth failure marks it invalid; success confirms it. */
  recordOutcome(scope: SecretScope, name: string, outcome: { ok: boolean; message?: string }) {
    const m = this.meta(scope, name);
    if (!m) return;
    if (!outcome.ok && isAuthFailure(outcome.message)) {
      const error = outcome.message!.slice(0, 300);
      this.update(m, (h) => ({ ...h, status: "invalid", error, checkedAt: this.now() }));
      this.k.audit("kiln", "credential.invalid", key(m), { error });
    } else if (outcome.ok) {
      this.update(m, (h) => (h.status === "limited" ? h : { ...h, status: "ok", error: undefined, checkedAt: this.now() }));
    }
  }

  /** "Check now": one minimal Claude Code run with this token, in a throwaway local sandbox. Uses a little of its quota. */
  async check(scope: SecretScope, name: string): Promise<PoolEntry> {
    const m = this.meta(scope, name);
    if (!m) throw new KilnError("resource_not_found", `no Claude token ${name} in this scope`);
    const env = this.k.vault.resolver(scope).envFor(name) ?? {};
    // The same backend and image as real runs: the Claude Code CLI lives in the sandbox image, not the server.
    const backend = this.k.options.defaultBackend ?? "local";
    const provider = this.k.sandboxes[backend] ?? this.k.sandboxes.local!;
    const sandbox = await provider.create({ runner: { image: this.k.options.defaultImage ?? "node:22-bookworm", backend, setupCommands: [], egress: ["api.anthropic.com", "claude.ai"] }, repos: [] });
    try {
      const session = await this.k.harnessFor("claude-code", "CUSTOM").start({ sandbox, instructions: "", prompt: "Reply with exactly: ok", model: "claude-haiku-5-5", env });
      for await (const e of session.events) if (e.type === "rate_limit") this.recordUsage(scope, name, e);
      const result = await session.result;
      this.recordOutcome(scope, name, { ok: result.outcome === "succeeded", message: result.summary });
    } catch (err) {
      this.recordOutcome(scope, name, { ok: false, message: err instanceof Error ? err.message : String(err) });
    } finally {
      await sandbox.destroy().catch(() => {});
    }
    return this.entry(this.meta(scope, name)!);
  }

  private meta(scope: SecretScope, name: string) {
    return this.candidates(scope).find((m) => m.name === name);
  }

  private now() {
    return this.k.clock.now().toISOString();
  }

  /** Change the record for the secret's current value; a new value starts from unknown. */
  private update(m: SecretMeta, change: (h: Health) => Health) {
    const id = key(m);
    const prior = this.k.store.get<Health>(CREDENTIAL_HEALTH, id);
    const current: Health =
      prior && prior.secretUpdatedAt === m.updatedAt
        ? prior
        : { id, status: "unknown", secretUpdatedAt: m.updatedAt, ...(prior?.lastUsedAt ? { lastUsedAt: prior.lastUsedAt } : {}) };
    this.k.store.put(CREDENTIAL_HEALTH, change(current));
  }
}
