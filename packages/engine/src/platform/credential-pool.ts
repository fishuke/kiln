import type { UsageWindow } from "@kiln/harness";
import { shellQuote, type Sandbox } from "@kiln/sandbox";
import { KilnError } from "../errors";
import type { Kiln } from "../kiln";
import { canonicalChatgptAuth, CHATGPT_EGRESS, chatgptRefreshDue, codexHome, isChatgptRefresh, parseChatgptAuth, redactChatgptTokens, removeCodexHome, writeCodexConfig } from "./chatgpt";
import type { SecretMeta } from "./types";
import { secretEnv, type SecretScope } from "./vault";

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

export type PoolEntry = Omit<Health, "id" | "secretUpdatedAt"> & { name: string; scope: SecretMeta["scope"]; updatedAt: string; description?: string };

/** The credential a run or check was given, by its exact owner and kind: never looked up by name again. */
export type PoolCredential = Pick<SecretMeta, "scope" | "owner" | "name"> & { kind: PoolKind };

/** Provider answers that mean the token itself is wrong, expired or revoked (not a busy or failing model). */
const AUTH_FAILURE =
  /\b401\b|authenticat|invalid (bearer|api key|x-api-key|token)|oauth token (has )?(expired|been revoked|revoked)|token (has )?(expired|been revoked)|refresh_token_failed|refresh token|(sign|log) ?in again/i;
export const isAuthFailure = (text: string | undefined) => Boolean(text && AUTH_FAILURE.test(text));

/** claude: Claude subscription tokens for Claude Code; chatgpt: ChatGPT logins (Codex's auth.json) for Codex. */
export type PoolKind = "claude" | "chatgpt";
const TYPE = { claude: "claude_oauth_token", chatgpt: "chatgpt_auth" } as const;
const LABEL = { claude: "Claude token", chatgpt: "ChatGPT login" } as const;
const HARNESS = { claude: "claude-code", chatgpt: "codex" } as const;
const key = (m: Pick<SecretMeta, "scope" | "owner" | "name">) => `${m.scope}:${m.owner}:${m.name}`;
const load = (e: PoolEntry) => Math.max(e.fiveHour?.utilization ?? 0, e.sevenDay?.utilization ?? 0);
const credentialOf = (m: SecretMeta, kind: PoolKind): PoolCredential => ({ scope: m.scope, owner: m.owner, name: m.name, kind });

/**
 * Several subscription credentials for one team or person: Claude tokens (`claude setup-token`) and
 * ChatGPT logins. Every run reports the usage windows of the one it used; runs go to the usable one
 * with the most left. A ChatGPT login that Codex is about to refresh serves one run at a time, because
 * a refresh replaces its refresh token and a second run holding the old one would be signed out.
 */
export class CredentialPool {
  /** Runs currently holding each ChatGPT login. */
  private readonly inUse = new Map<string, number>();

  constructor(private readonly k: Kiln) {}

  /** Credentials a run in this scope may use: the person's own, then the team's. */
  private candidates(scope: SecretScope, kind: PoolKind = "claude"): SecretMeta[] {
    const all = this.k.vault.list(scope);
    // A personal secret shadows a team one of the same name, so a name always means one login.
    const personal = new Set(all.filter((m) => m.scope === "personal" && m.type === TYPE[kind]).map((m) => m.name));
    return all
      .filter((m) => m.type === TYPE[kind] && (kind === "claude" || m.scope === "personal" || !personal.has(m.name)))
      .sort((a, b) => (a.scope === b.scope ? a.name.localeCompare(b.name) : a.scope === "personal" ? -1 : 1));
  }

  /** A Claude token's variables, read by its exact scope and owner (a personal token may share a team token's name). */
  private envOf(m: SecretMeta): Record<string, string> {
    return secretEnv(m.type, m.name, this.k.vault.typedValue(m.scope, m.owner, m.name, m.type));
  }

  /** A ChatGPT login's auth.json, read by its exact scope and owner. */
  private loginValue(m: SecretMeta): string | undefined {
    const v = this.k.vault.typedValue(m.scope, m.owner, m.name, "chatgpt_auth");
    return typeof v === "string" ? v : undefined;
  }

  private entry(m: SecretMeta): PoolEntry {
    const base = { name: m.name, scope: m.scope, updatedAt: m.updatedAt, ...(m.description ? { description: m.description } : {}) };
    const h = this.k.store.get<Health>(CREDENTIAL_HEALTH, key(m));
    if (!h || h.secretUpdatedAt !== m.updatedAt) return { ...base, status: "unknown", ...(h?.lastUsedAt ? { lastUsedAt: h.lastUsedAt } : {}) };
    const { id: _id, secretUpdatedAt: _version, fiveHour, sevenDay, ...rest } = h;
    // A window that has reset no longer counts (Codex reports usage only when it hits a limit, so nothing else replaces it).
    const current = (w?: UsageWindow) => (w && !(w.resetsAt && w.resetsAt <= this.now()) ? w : undefined);
    const windows = { ...(current(fiveHour) ? { fiveHour } : {}), ...(current(sevenDay) ? { sevenDay } : {}) };
    // A limited token whose window has reset is worth trying again.
    if (h.status === "limited" && (!h.resetsAt || h.resetsAt <= this.now())) return { ...base, ...rest, ...windows, status: "unknown" };
    return { ...base, ...rest, ...windows };
  }

  list(teamId: string, userId?: string, kind: PoolKind = "claude"): PoolEntry[] {
    return this.candidates({ teamId, userId }, kind).map((m) => this.entry(m));
  }

  /**
   * The token for the next run: usable ones (ok or unknown) by most headroom, then least recently used.
   * Undefined when the scope has no subscription tokens; an error when it has some but none is usable.
   */
  choose(scope: SecretScope, kind: PoolKind = "claude"): { name: string; credential: PoolCredential; env: Record<string, string>; value?: string } | undefined {
    const all = this.candidates(scope, kind).map((m) => ({ m, e: this.entry(m) }));
    if (!all.length) return undefined;
    const usable = all.filter(({ e }) => e.status === "ok" || e.status === "unknown");
    const value = (m: SecretMeta) => this.loginValue(m);
    // A ChatGPT login due for a refresh is never handed to a second run (or check) at the same time.
    const free = kind === "chatgpt" ? usable.filter(({ m }) => this.mayTake(m)) : usable;
    if (usable.length && !free.length)
      throw new KilnError("resource_unavailable", "every ChatGPT login is being refreshed by another run; this run will try again", { integrationName: "codex" });
    const pick = free
      .sort((a, b) => load(a.e) - load(b.e) || (a.e.lastUsedAt ?? "").localeCompare(b.e.lastUsedAt ?? "") || a.m.name.localeCompare(b.m.name))[0];
    if (!pick) {
      const why = all
        .map(({ e }) => (e.status === "limited" ? `${e.name} is limited until ${e.resetsAt}` : `${e.name} is invalid (${e.error ?? "rejected"})`))
        .join("; ");
      throw new KilnError("integration_not_configured", `every ${LABEL[kind]} is unusable: ${why}. Add one or check them under Settings → Model keys.`, {
        integrationName: HARNESS[kind],
      });
    }
    this.update(pick.m, (h) => ({ ...h, lastUsedAt: this.now() }));
    const credential = credentialOf(pick.m, kind);
    if (kind === "chatgpt") {
      this.take(pick.m);
      return { name: pick.m.name, credential, env: {}, value: value(pick.m) };
    }
    return { name: pick.m.name, credential, env: this.envOf(pick.m) };
  }

  /** Whether another run may hold this ChatGPT login now: only one at a time while Codex is due to refresh it. */
  private mayTake(m: SecretMeta) {
    return !this.inUse.get(key(m)) || !chatgptRefreshDue(parseChatgptAuth(this.loginValue(m) ?? ""), this.k.clock.now());
  }

  private take(m: SecretMeta) {
    this.inUse.set(key(m), (this.inUse.get(key(m)) ?? 0) + 1);
  }

  /** A run is done with the ChatGPT login it was given. */
  release(credential: PoolCredential) {
    const id = key(credential);
    const n = (this.inUse.get(id) ?? 1) - 1;
    if (n > 0) this.inUse.set(id, n);
    else this.inUse.delete(id);
  }

  /** Writes a ChatGPT login into a sandbox for Codex, in `home` (from codexHome). */
  async writeChatgptLogin(sandbox: Sandbox, home: string, value: string): Promise<void> {
    await writeCodexConfig(sandbox, home);
    await sandbox.writeFile(`${home}/auth.json`, value);
    await sandbox.exec(`chmod 600 ${shellQuote(`${home}/auth.json`)}`, { trusted: true });
  }

  /**
   * Codex rewrites auth.json when it refreshes the login, and the old refresh token stops working.
   * Keeps the refreshed file, without resetting the login's health (it is the same login).
   */
  async saveChatgptLogin(credential: PoolCredential, sandbox: Sandbox, home: string, by: string) {
    try {
      const m = this.metaOf(credential);
      const stored = m ? this.loginValue(m) : undefined;
      const raw = await sandbox.readFile(`${home}/auth.json`);
      // The agent can write this file too: only a real refresh of the same account is kept, in canonical form.
      if (!m || !stored || !raw || !isChatgptRefresh(stored, raw, this.k.clock.now())) return;
      const prior = this.k.store.get<Health>(CREDENTIAL_HEALTH, key(m));
      const saved = this.k.vault.set({ scope: m.scope, owner: m.owner, name: m.name, type: "chatgpt_auth", value: canonicalChatgptAuth(raw) }, by);
      this.k.audit(by, "chatgpt.refreshed", key(m), { lastRefresh: parseChatgptAuth(raw)?.lastRefresh });
      if (prior && prior.secretUpdatedAt === m.updatedAt) this.k.store.put(CREDENTIAL_HEALTH, { ...prior, secretUpdatedAt: saved.updatedAt });
    } finally {
      await removeCodexHome(sandbox, home);
    }
  }

  /** A run's usage report for the token it used. */
  recordUsage(credential: PoolCredential, report: { status: string; fiveHour?: UsageWindow; sevenDay?: UsageWindow; others?: Record<string, UsageWindow> }) {
    const m = this.metaOf(credential);
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
  recordOutcome(credential: PoolCredential, outcome: { ok: boolean; message?: string }) {
    const m = this.metaOf(credential);
    if (!m) return;
    if (!outcome.ok && isAuthFailure(outcome.message)) {
      const error = outcome.message!.slice(0, 300);
      this.update(m, (h) => ({ ...h, status: "invalid", error, checkedAt: this.now() }));
      this.k.audit("kiln", "credential.invalid", key(m), { error });
    } else if (outcome.ok) {
      this.update(m, (h) => (h.status === "limited" ? h : { ...h, status: "ok", error: undefined, checkedAt: this.now() }));
    }
  }

  /** "Check now": one minimal run with this credential, in a throwaway sandbox. Uses a little of its quota. */
  async check(scope: SecretScope, name: string, kind: PoolKind = "claude"): Promise<PoolEntry> {
    const m = this.meta(scope, name, kind);
    if (!m) throw new KilnError("resource_not_found", `no ${LABEL[kind]} ${name} in this scope`);
    const credential = credentialOf(m, kind);
    // A check holds a ChatGPT login like a run: a refresh by both would sign the other out.
    if (kind === "chatgpt") {
      if (!this.mayTake(m)) throw new KilnError("resource_unavailable", `${name} is being refreshed by a run; check it again when the run ends`, { integrationName: "codex" });
      this.take(m);
    }
    // The same backend and image as real runs: the agent CLIs live in the sandbox image, not the server.
    const backend = this.k.options.defaultBackend ?? "local";
    const provider = this.k.sandboxes[backend] ?? this.k.sandboxes.local!;
    const egress = kind === "claude" ? ["api.anthropic.com", "claude.ai"] : ["api.openai.com", ...CHATGPT_EGRESS];
    let sandbox: Sandbox;
    try {
      sandbox = await provider.create({ runner: { image: this.k.options.defaultImage ?? "node:22-bookworm", backend, setupCommands: [], egress }, repos: [] });
    } catch (err) {
      if (kind === "chatgpt") this.release(credential);
      throw err;
    }
    let home: string | undefined;
    try {
      let env: Record<string, string> = kind === "claude" ? this.envOf(m) : {};
      if (kind === "chatgpt") {
        home = codexHome(`check-${m.name}`);
        await this.writeChatgptLogin(sandbox, home, this.loginValue(m) ?? "");
        env = { CODEX_HOME: home };
      }
      const session = await this.k.harnessFor(HARNESS[kind], "CUSTOM").start({ sandbox, instructions: "", prompt: "Reply with exactly: ok", ...(kind === "claude" ? { model: "claude-haiku-5-5" } : {}), env });
      for await (const e of session.events) if (e.type === "rate_limit") this.recordUsage(credential, e);
      const result = await session.result;
      this.recordOutcome(credential, { ok: result.outcome === "succeeded", message: this.redact(m, result.summary) });
    } catch (err) {
      this.recordOutcome(credential, { ok: false, message: this.redact(m, err instanceof Error ? err.message : String(err)) });
    } finally {
      if (home) await this.saveChatgptLogin(credential, sandbox, home, "kiln:check").catch(() => {});
      if (kind === "chatgpt") this.release(credential);
      await sandbox.destroy().catch(() => {});
    }
    return this.entry(this.metaOf(credential) ?? m);
  }

  /** Check output can quote the credential; members see it in the pool's error. */
  private redact(m: SecretMeta, text: string) {
    const tokens = m.type === "chatgpt_auth" ? (parseChatgptAuth(this.loginValue(m) ?? "")?.tokens ?? []) : [];
    return redactChatgptTokens(tokens.reduce((t, s) => (s.length >= 6 ? t.split(s).join("[redacted]") : t), text));
  }

  private meta(scope: SecretScope, name: string, kind: PoolKind) {
    return this.candidates(scope, kind).find((m) => m.name === name);
  }

  /** The credential's current version, if it still exists as the same kind. */
  private metaOf(c: PoolCredential) {
    const m = this.k.vault.getMeta(c.scope, c.owner, c.name);
    return m?.type === TYPE[c.kind] ? m : undefined;
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
