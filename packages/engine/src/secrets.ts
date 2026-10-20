import { createHmac, randomBytes } from "node:crypto";
import type { Store } from "@kiln/store";
import { C, type Clock } from "./types";

/** Model-provider credentials a self-hosted install may provide through the environment (BYOK). */
export const BYOK_ENV = ["CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "CODEX_API_KEY", "OPENROUTER_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY"];

export type ForgeAction = "push" | "open_pr" | "comment" | "label" | "approve" | "merge";

type Claims = { runId: string; repos: string[]; branchPrefix: string; actions: ForgeAction[]; exp: number };

/**
 * Issues short-lived run tokens for agents. A token may push only `kiln/*` branches of the
 * repos it names, open PRs and comment. Approve and merge are never granted: no agent identity
 * holds those permissions, so a human always merges.
 */
export class SecretsBroker {
  private readonly key: Buffer;

  constructor(
    private readonly store: Store,
    private readonly clock: Clock,
    key?: string,
  ) {
    this.key = Buffer.from(key ?? randomBytes(32).toString("hex"));
  }

  issueRunToken(runId: string, repos: string[], ttlMinutes = 60): string {
    const claims: Claims = {
      runId,
      repos,
      branchPrefix: "kiln/",
      actions: ["push", "open_pr", "comment", "label"],
      exp: this.clock.now().getTime() + ttlMinutes * 60_000,
    };
    const body = Buffer.from(JSON.stringify(claims)).toString("base64url");
    return `krt_${body}.${createHmac("sha256", this.key).update(body).digest("base64url")}`;
  }

  verify(token: string): Claims | undefined {
    const m = /^krt_([^.]+)\.(.+)$/.exec(token);
    if (!m) return undefined;
    const expected = createHmac("sha256", this.key).update(m[1]!).digest("base64url");
    if (expected !== m[2]) return undefined;
    const claims = JSON.parse(Buffer.from(m[1]!, "base64url").toString()) as Claims;
    return claims.exp > this.clock.now().getTime() ? claims : undefined;
  }

  authorize(token: string, action: ForgeAction, repo: string, ref?: string): { ok: boolean; reason?: string } {
    const claims = this.verify(token);
    if (!claims) return { ok: false, reason: "invalid or expired token" };
    if (!claims.actions.includes(action)) return { ok: false, reason: `run tokens cannot ${action}` };
    if (!claims.repos.includes(repo)) return { ok: false, reason: `token is not valid for ${repo}` };
    if (action === "push" && !(ref ?? "").startsWith(claims.branchPrefix)) {
      return { ok: false, reason: `run tokens can only push ${claims.branchPrefix}* branches` };
    }
    return { ok: true };
  }

  /** Named secrets (webhook secrets, API keys) kept in the store; values never leave the control plane. */
  setSecret(name: string, value: string) {
    this.store.put(C.secrets, { id: name, value, updatedAt: this.clock.now().toISOString() });
  }

  /**
   * Stored secrets first. From the server's environment only model-provider keys and
   * KILN_SECRET_<NAME> variables are readable, so an agent definition cannot ask for the
   * server's own credentials by name.
   */
  getSecret(name: string): string | undefined {
    const stored = this.store.get<{ id: string; value: string }>(C.secrets, name)?.value;
    if (stored) return stored;
    if (BYOK_ENV.includes(name)) return process.env[name];
    return process.env[`KILN_SECRET_${name}`];
  }

  listSecretNames(): string[] {
    const stored = this.store.list<{ id: string }>(C.secrets).map((s) => s.id);
    const fromEnv = [...BYOK_ENV.filter((n) => process.env[n]), ...Object.keys(process.env).filter((k) => k.startsWith("KILN_SECRET_")).map((k) => k.slice(12))];
    return [...new Set([...stored, ...fromEnv])].sort();
  }
}
