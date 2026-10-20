import { randomBytes } from "node:crypto";
import { shellQuote, type Sandbox } from "@kiln/sandbox";
import { z } from "zod";
import { KilnError } from "../errors";
import type { Kiln } from "../kiln";
import type { SecretMeta } from "./types";

/** Hosts Codex needs with a ChatGPT login: sign-in and token refresh, and the ChatGPT backend it calls. */
export const CHATGPT_EGRESS = ["auth.openai.com", "chatgpt.com"];
/**
 * Where a Codex login lives inside the sandbox: outside the workspace (never committed or snapshotted),
 * with a random part so it cannot be guessed or prepared in advance on a shared local /tmp.
 */
export const codexHome = (id: string) => `/tmp/kiln-codex-${id}-${randomBytes(6).toString("hex")}`;
/** Removes a Codex home (a local sandbox's /tmp is the host's, and outlives the sandbox). */
export async function removeCodexHome(sandbox: Sandbox, home: string) {
  await sandbox.exec(`rm -rf ${shellQuote(home)}`, { trusted: true }).catch(() => undefined);
}
/** Codex refreshes a login it has not refreshed for about 8 days; a day earlier it is "due". */
const DUE_AFTER_MS = 7 * 24 * 3600 * 1000;

const AUTH_FILE = z.object({
  auth_mode: z.string().optional(),
  tokens: z.object({ id_token: z.string().min(1), access_token: z.string().min(1), refresh_token: z.string().min(1), account_id: z.string().optional() }),
  last_refresh: z.string().optional(),
});

export type ChatgptAuth = {
  /** Every token in the file, redacted from run output. */
  tokens: string[];
  refreshToken: string;
  email?: string;
  plan?: string;
  accountId?: string;
  lastRefresh?: string;
};

function readAuthFile(raw: string) {
  try {
    const parsed = AUTH_FILE.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/** Codex's auth.json from a ChatGPT sign-in; undefined when it is not one (an API key file, or no refresh token). */
export function parseChatgptAuth(raw: string): ChatgptAuth | undefined {
  const file = readAuthFile(raw);
  if (!file) return undefined;
  const { tokens, last_refresh } = file;
  const claims = jwtClaims(tokens.id_token);
  const auth = (claims["https://api.openai.com/auth"] ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);
  return {
    tokens: [tokens.id_token, tokens.access_token, tokens.refresh_token],
    refreshToken: tokens.refresh_token,
    email: str(claims.email),
    plan: str(auth.chatgpt_plan_type),
    accountId: tokens.account_id ?? str(auth.chatgpt_account_id),
    lastRefresh: last_refresh,
  };
}

/** Only the fields Codex reads, re-serialized: whatever else a file carries is never stored or handed to a run. */
export function canonicalChatgptAuth(raw: string): string | undefined {
  const file = readAuthFile(raw);
  if (!file) return undefined;
  const { id_token, access_token, refresh_token, account_id } = file.tokens;
  return JSON.stringify({
    ...(file.auth_mode ? { auth_mode: file.auth_mode } : {}),
    OPENAI_API_KEY: null,
    tokens: { id_token, access_token, refresh_token, ...(account_id ? { account_id } : {}) },
    ...(file.last_refresh ? { last_refresh: file.last_refresh } : {}),
  });
}

/**
 * Whether the auth.json a run left behind is a genuine refresh of the stored login: the same ChatGPT
 * account, a new refresh token and a later (not future) refresh time. Anything else, such as a file the
 * agent wrote itself, is ignored, so a run can never replace the login with another account.
 */
export function isChatgptRefresh(stored: string, next: string, now: Date): boolean {
  const a = parseChatgptAuth(stored);
  const b = parseChatgptAuth(next);
  if (!a || !b || !a.accountId || a.accountId !== b.accountId || a.refreshToken === b.refreshToken || !b.lastRefresh) return false;
  const at = Date.parse(b.lastRefresh);
  return Number.isFinite(at) && at <= now.getTime() + 5 * 60_000 && (!a.lastRefresh || at > Date.parse(a.lastRefresh));
}

/** Codex's tokens wherever they appear in text: JWTs and the token fields of an auth.json. */
export function redactChatgptTokens(text: string): string {
  return text
    .replace(/eyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]+/g, "[redacted]")
    .replace(/("(?:refresh_token|access_token|id_token)"\s*:\s*")[^"]+"/g, '$1[redacted]"');
}

/** True when Codex will refresh this login on its next run, so it should not be shared by two runs at once. */
export function chatgptRefreshDue(auth: ChatgptAuth | undefined, now: Date): boolean {
  return !auth?.lastRefresh || now.getTime() - Date.parse(auth.lastRefresh) >= DUE_AFTER_MS;
}

/** Creates a Codex home that keeps its login in auth.json (not an OS keyring); Codex refuses a missing one. */
export async function writeCodexConfig(sandbox: Sandbox, home: string): Promise<string> {
  await sandbox.writeFile(`${home}/config.toml`, 'cli_auth_credentials_store = "file"\n');
  // Readable only by the sandbox user (on a local sandbox, /tmp is shared with the host).
  await sandbox.exec(`chmod 700 ${shellQuote(home)}`, { trusted: true });
  return home;
}

function jwtClaims(jwt: string): Record<string, unknown> {
  try {
    return JSON.parse(Buffer.from(jwt.split(".")[1] ?? "", "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

const ANSI = new RegExp(String.raw`\u001b\[[0-9;]*m`, "g");

/** The link and one-time code `codex login --device-auth` prints. */
export function parseDeviceAuth(output: string): { verificationUrl: string; userCode: string } | undefined {
  const text = output.replace(ANSI, "");
  const verificationUrl = /https:\/\/auth\.openai\.com\/\S+/.exec(text)?.[0];
  const userCode = /one-time code[^\n]*\n\s*([A-Z0-9]{4,}-[A-Z0-9]{4,})/i.exec(text)?.[1];
  return verificationUrl && userCode ? { verificationUrl, userCode } : undefined;
}

export type ChatgptSignInState = {
  id: string;
  name: string;
  scope: SecretMeta["scope"];
  status: "pending" | "succeeded" | "failed" | "cancelled";
  verificationUrl?: string;
  userCode?: string;
  expiresAt: string;
  email?: string;
  plan?: string;
  error?: string;
};

type Session = ChatgptSignInState & { teamId: string; owner: string; by: string; userId?: string; home?: string; closing?: boolean; sandbox?: Sandbox; kill?: () => void };

const SIGN_IN_TIMEOUT_MS = 15 * 60_000;
/** Pending sign-ins one team may have at once; each holds a sandbox for up to 15 minutes. */
const MAX_PENDING_PER_TEAM = 5;

/**
 * "Sign in with ChatGPT": runs `codex login --device-auth` in a throwaway sandbox, hands its link and code
 * to the person, and when they approve stores the resulting auth.json as a `chatgpt_auth` secret.
 * Sessions live in memory; a restart loses pending ones (the person starts again). A session is visible
 * only to the person who started it and to team admins: whoever enters its code chooses the account.
 */
export class ChatgptSignIn {
  private readonly sessions = new Map<string, Session>();

  constructor(private readonly k: Kiln) {}

  async start(input: { teamId: string; scope: SecretMeta["scope"]; owner: string; name: string; by: string; userId?: string }): Promise<ChatgptSignInState> {
    const existing = this.k.vault.getMeta(input.scope, input.owner, input.name);
    if (existing && existing.type !== "chatgpt_auth") throw new KilnError("conflict", `${input.name} is already a ${existing.type} secret; choose another name`);
    const pending = [...this.sessions.values()].filter((s) => s.status === "pending" && s.teamId === input.teamId);
    // One pending sign-in per person (a new one replaces it), and a few per team.
    for (const s of pending.filter((p) => input.userId && p.userId === input.userId)) await this.finish(s, "cancelled");
    if (pending.filter((s) => s.status === "pending").length >= MAX_PENDING_PER_TEAM)
      throw new KilnError("resource_unavailable", "too many ChatGPT sign-ins are waiting in this team; finish or cancel one first");

    const id = `cgl_${randomBytes(8).toString("hex")}`;
    const session: Session = { id, ...input, status: "pending", expiresAt: new Date(this.k.clock.now().getTime() + SIGN_IN_TIMEOUT_MS).toISOString() };
    this.sessions.set(id, session);
    let output = "";
    try {
      const backend = this.k.options.defaultBackend ?? "local";
      const provider = this.k.sandboxes[backend] ?? this.k.sandboxes.local!;
      const sandbox = await provider.create({
        runner: { image: this.k.options.defaultImage ?? "node:22-bookworm", backend, setupCommands: [], egress: CHATGPT_EGRESS },
        repos: [],
      });
      session.sandbox = sandbox;
      const home = (session.home = await writeCodexConfig(sandbox, codexHome(id)));
      const proc = sandbox.spawn("codex", ["login", "--device-auth"], { env: { CODEX_HOME: home, NO_COLOR: "1" } });
      session.kill = () => proc.kill();
      const timer = setTimeout(() => void this.finish(session, "failed", "the code expired before it was approved"), SIGN_IN_TIMEOUT_MS);
      timer.unref?.();

      // The link and code come first; the process then waits until the person approves.
      const prompt = new Promise<void>((resolve) => {
        void (async () => {
          for await (const line of proc.lines) {
            output += `${line}\n`;
            const found = parseDeviceAuth(output);
            if (found && !session.userCode) {
              Object.assign(session, found);
              resolve();
            }
          }
          resolve();
        })();
      });
      void proc.exit
        .then(async (exit) => {
          clearTimeout(timer);
          if (session.status !== "pending") return;
          if (exit.code !== 0) return this.finish(session, "failed", tail(exit.stderr || output) || `codex login exited with code ${exit.code}`);
          const raw = await sandbox.readFile(`${home}/auth.json`);
          const value = raw ? canonicalChatgptAuth(raw) : undefined;
          const auth = value ? parseChatgptAuth(value) : undefined;
          // Cancelled while the file was being read: nothing is stored.
          if (session.status !== "pending" || session.closing) return;
          if (!value || !auth) return this.finish(session, "failed", "the sign-in finished but Codex wrote no ChatGPT login");
          const description = `ChatGPT login${auth.email ? ` for ${auth.email}` : ""}${auth.plan ? ` (${auth.plan})` : ""}`;
          this.k.vault.set({ scope: session.scope, owner: session.owner, name: session.name, type: "chatgpt_auth", value, description }, session.by);
          this.k.audit(session.by, "chatgpt.signed_in", `${session.scope}:${session.owner}:${session.name}`, { email: auth.email, plan: auth.plan });
          Object.assign(session, { email: auth.email, plan: auth.plan });
          await this.finish(session, "succeeded");
        })
        .catch((err: unknown) => this.finish(session, "failed", err instanceof Error ? err.message : String(err)));
      await Promise.race([prompt, proc.exit]);
      if (!session.userCode && session.status === "pending") {
        const exited = await Promise.race([proc.exit, Promise.resolve(undefined)]);
        await this.finish(session, "failed", tail(exited?.stderr || output) || "codex login printed no device code");
      }
    } catch (err) {
      await this.finish(session, "failed", err instanceof Error ? err.message : String(err));
    }
    return this.view(session);
  }

  get(teamId: string, id: string, who: { userId?: string; admin: boolean }): ChatgptSignInState {
    return this.view(this.own(teamId, id, who));
  }

  async cancel(teamId: string, id: string, who: { userId?: string; admin: boolean }): Promise<ChatgptSignInState> {
    const s = this.own(teamId, id, who);
    if (s.status === "pending") await this.finish(s, "cancelled");
    return this.view(s);
  }

  private own(teamId: string, id: string, who: { userId?: string; admin: boolean }): Session {
    const s = this.sessions.get(id);
    if (!s || s.teamId !== teamId || !(who.admin || (who.userId && s.userId === who.userId))) throw new KilnError("resource_not_found", `no ChatGPT sign-in ${id}`);
    return s;
  }

  /** Ends a session: stops Codex and removes its sandbox, then reports the outcome (so a poller never sees it early). */
  private async finish(s: Session, status: Exclude<Session["status"], "pending">, error?: string) {
    if (s.status !== "pending" || s.closing) return;
    s.closing = true;
    s.kill?.();
    if (s.sandbox && s.home) await removeCodexHome(s.sandbox, s.home);
    await s.sandbox?.destroy().catch(() => {});
    s.status = status;
    if (error) s.error = error;
    // Kept a while so the page polling it sees the outcome.
    setTimeout(() => this.sessions.delete(s.id), SIGN_IN_TIMEOUT_MS).unref?.();
  }

  private view(s: Session): ChatgptSignInState {
    const { teamId: _t, owner: _o, by: _b, userId: _u, home: _h, closing: _c, sandbox: _s, kill: _k, ...state } = s;
    return state;
  }
}

const tail = (text: string) => text.replace(ANSI, "").trim().slice(-300);
