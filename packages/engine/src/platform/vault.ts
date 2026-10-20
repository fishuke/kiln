import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import type { Kiln } from "../kiln";
import { canonicalChatgptAuth } from "./chatgpt";
import { P, PlatformError, type ManagedSecret, type SecretMeta, type SecretType } from "./types";

export const MAX_SECRET_BYTES = 128 * 1024;
export const SECRET_NAME = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,127}$/, "use letters, digits and underscores, starting with a letter or underscore");

const str = z.string().min(1);

/** The value shape each secret type accepts. */
export const SECRET_VALUE: Record<SecretType, z.ZodType> = {
  raw: str,
  docker_registry: z.object({ host: str, username: str, password: str }).strict(),
  aws_ecr: z.object({ roleArn: z.string().regex(/^arn:aws[\w-]*:iam::\d{12}:role\/.+$/, "expected an IAM role ARN"), region: str }).strict(),
  anthropic_api_key: str,
  claude_oauth_token: str,
  // Codex's auth.json from "Sign in with ChatGPT"; written to the sandbox as a file, not an env var.
  chatgpt_auth: str
    .transform((v) => canonicalChatgptAuth(v) ?? "")
    .refine((v) => v !== "", "expected Codex's auth.json from a ChatGPT sign-in (with a refresh token)"),
  anthropic_bedrock_api_key: z.union([str, z.object({ apiKey: str, region: str.optional() }).strict()]),
  anthropic_bedrock_access_key: z.object({ accessKeyId: str, secretAccessKey: str, sessionToken: str.optional(), region: str }).strict(),
  openai_api_key: str,
  openrouter_api_key: str,
  google_api_key: str,
};

/** Environment variables a typed secret provides to a run. Registry credentials are not env vars. */
export function secretEnv(type: SecretType, name: string, value: unknown): Record<string, string> {
  const v = value as Record<string, string>;
  switch (type) {
    case "raw":
      return { [name]: String(value) };
    case "anthropic_api_key":
      return { ANTHROPIC_API_KEY: String(value) };
    case "claude_oauth_token":
      return { CLAUDE_CODE_OAUTH_TOKEN: String(value) };
    case "anthropic_bedrock_api_key":
      return typeof value === "string"
        ? { AWS_BEARER_TOKEN_BEDROCK: value, CLAUDE_CODE_USE_BEDROCK: "1" }
        : { AWS_BEARER_TOKEN_BEDROCK: v.apiKey!, ...(v.region ? { AWS_REGION: v.region } : {}), CLAUDE_CODE_USE_BEDROCK: "1" };
    case "anthropic_bedrock_access_key":
      return { AWS_ACCESS_KEY_ID: v.accessKeyId!, AWS_SECRET_ACCESS_KEY: v.secretAccessKey!, ...(v.sessionToken ? { AWS_SESSION_TOKEN: v.sessionToken } : {}), AWS_REGION: v.region!, CLAUDE_CODE_USE_BEDROCK: "1" };
    case "openai_api_key":
      return { OPENAI_API_KEY: String(value) };
    case "openrouter_api_key":
      return { OPENROUTER_API_KEY: String(value) };
    case "google_api_key":
      return { GOOGLE_GENERATIVE_AI_API_KEY: String(value) };
    default:
      return {};
  }
}

/** Team-managed model keys are team secrets with fixed names. */
export const MODEL_KEYS = {
  anthropic: { name: "KILN_MODEL_ANTHROPIC", type: "anthropic_api_key" },
  openai: { name: "KILN_MODEL_OPENAI", type: "openai_api_key" },
  openrouter: { name: "KILN_MODEL_OPENROUTER", type: "openrouter_api_key" },
  bedrock: { name: "KILN_MODEL_BEDROCK", type: "anthropic_bedrock_access_key" },
} as const satisfies Record<string, { name: string; type: SecretType }>;
export type ModelKeyProvider = keyof typeof MODEL_KEYS;

export type SecretScope = { teamId?: string; userId?: string };

/** What a run can see: personal secrets of the user who triggered it, then team secrets, then server secrets. */
export type SecretResolver = {
  /** A secret's value by name (objects come back as JSON). */
  get(name: string): string | undefined;
  /** The env vars a named secret provides (typed secrets expand to their provider variables). */
  envFor(name: string): Record<string, string> | undefined;
  /** A typed secret (or a server secret) that provides this env var, with everything it provides. */
  provide(envVar: string): Record<string, string> | undefined;
};

/** Team and personal secrets. Values are write-only: the API returns metadata, runs get values. */
export class SecretVault {
  private readonly key?: Buffer;

  constructor(private readonly k: Kiln) {
    this.key = k.options.secretKey ? createHash("sha256").update(`kiln-vault:${k.options.secretKey}`).digest() : undefined;
  }

  /** Encrypt with KILN_SECRET_KEY (AES-256-GCM); for engine services that keep credentials outside the vault. */
  seal(value: unknown): string {
    const plain = JSON.stringify(value);
    if (!this.key) return `plain:${plain}`;
    const iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", this.key, iv);
    const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
    return `v1:${iv.toString("base64url")}:${c.getAuthTag().toString("base64url")}:${ct.toString("base64url")}`;
  }

  unseal(sealed: string): unknown {
    if (sealed.startsWith("plain:")) return JSON.parse(sealed.slice(6));
    const [, iv, tag, ct] = sealed.split(":");
    if (!this.key || !iv || !tag || !ct) throw new Error("cannot read a sealed secret without KILN_SECRET_KEY");
    const d = createDecipheriv("aes-256-gcm", this.key, Buffer.from(iv, "base64url"));
    d.setAuthTag(Buffer.from(tag, "base64url"));
    return JSON.parse(Buffer.concat([d.update(Buffer.from(ct, "base64url")), d.final()]).toString("utf8"));
  }

  private id(scope: "team" | "personal", owner: string, name: string) {
    return `${scope}:${owner}:${name}`;
  }

  private meta(s: ManagedSecret): SecretMeta {
    const { value: _v, ...rest } = s;
    return rest;
  }

  list(filter: { teamId?: string; userId?: string }): SecretMeta[] {
    return this.k.store
      .list<ManagedSecret>(P.secrets, (s) => (s.scope === "team" && s.owner === filter.teamId) || (s.scope === "personal" && s.owner === filter.userId))
      .map((s) => this.meta(s))
      .sort((a, b) => a.scope.localeCompare(b.scope) || a.name.localeCompare(b.name));
  }

  getMeta(scope: "team" | "personal", owner: string, name: string): SecretMeta | undefined {
    const s = this.k.store.get<ManagedSecret>(P.secrets, this.id(scope, owner, name));
    return s ? this.meta(s) : undefined;
  }

  set(input: { scope: "team" | "personal"; owner: string; name: string; type?: SecretType; value?: unknown; description?: string }, by: string): SecretMeta {
    SECRET_NAME.parse(input.name);
    const id = this.id(input.scope, input.owner, input.name);
    const existing = this.k.store.get<ManagedSecret>(P.secrets, id);
    const type = input.type ?? existing?.type ?? "raw";
    if (existing && input.type && input.type !== existing.type) throw new PlatformError(409, `${input.name} is a ${existing.type} secret; delete it to change its type`);
    if (type === "aws_ecr" && input.scope !== "team") throw new PlatformError(400, "AWS ECR credentials are team secrets");
    if (!existing && input.value === undefined) throw new PlatformError(400, "a new secret needs a value");
    let sealed = existing?.value;
    if (input.value !== undefined) {
      const parsed = SECRET_VALUE[type].safeParse(input.value);
      if (!parsed.success) throw new PlatformError(400, `invalid ${type} value: ${parsed.error.issues.map((i) => `${i.path.join(".") || "value"}: ${i.message}`).join("; ")}`);
      if (Buffer.byteLength(JSON.stringify(parsed.data)) > MAX_SECRET_BYTES) throw new PlatformError(400, "secret values are limited to 128 KiB");
      sealed = this.seal(parsed.data);
    }
    const now = this.k.clock.now().toISOString();
    const secret: ManagedSecret = {
      id,
      scope: input.scope,
      owner: input.owner,
      name: input.name,
      type,
      description: input.description ?? existing?.description,
      value: sealed!,
      createdBy: existing?.createdBy ?? by,
      createdAt: existing?.createdAt ?? now,
      updatedBy: by,
      updatedAt: now,
    };
    this.k.store.put(P.secrets, secret);
    this.k.audit(by, existing ? "secret.updated" : "secret.created", id, { type, scope: input.scope, valueChanged: input.value !== undefined });
    return this.meta(secret);
  }

  delete(scope: "team" | "personal", owner: string, name: string, by: string) {
    const id = this.id(scope, owner, name);
    if (!this.k.store.delete(P.secrets, id)) throw new PlatformError(404, `unknown secret ${name}`);
    this.k.audit(by, "secret.deleted", id);
  }

  private value(scope: "team" | "personal", owner: string | undefined, name: string): { type: SecretType; value: unknown } | undefined {
    if (!owner) return undefined;
    const s = this.k.store.get<ManagedSecret>(P.secrets, this.id(scope, owner, name));
    return s ? { type: s.type, value: this.unseal(s.value) } : undefined;
  }

  /** A secret's value by its exact scope and owner, only when it has this type (never through name resolution). */
  typedValue(scope: "team" | "personal", owner: string, name: string, type: SecretType): unknown {
    const v = this.value(scope, owner, name);
    return v?.type === type ? v.value : undefined;
  }

  /** Registry credentials for a runner image (docker_registry or aws_ecr), team scope. */
  registryCredential(teamId: string, name: string): { type: SecretType; value: unknown } | undefined {
    const v = this.value("team", teamId, name);
    return v && (v.type === "docker_registry" || v.type === "aws_ecr") ? v : undefined;
  }

  resolver(scope: SecretScope): SecretResolver {
    const find = (name: string) => this.value("personal", scope.userId, name) ?? this.value("team", scope.teamId, name);
    const typed = () =>
      this.k.store
        .list<ManagedSecret>(P.secrets, (s) => s.type !== "raw" && ((s.scope === "personal" && s.owner === scope.userId) || (s.scope === "team" && s.owner === scope.teamId)))
        .sort((a, b) => (a.scope === b.scope ? a.name.localeCompare(b.name) : a.scope === "personal" ? -1 : 1));
    const server = (name: string) => this.k.secrets.getSecret(name);
    return {
      get: (name) => {
        const s = find(name);
        if (s) return typeof s.value === "string" ? s.value : JSON.stringify(s.value);
        return server(name);
      },
      envFor: (name) => {
        const s = find(name);
        if (s) return secretEnv(s.type, name, s.value);
        const v = server(name);
        return v === undefined ? undefined : { [name]: v };
      },
      provide: (envVar) => {
        for (const s of typed()) {
          const env = secretEnv(s.type, s.name, this.unseal(s.value));
          if (env[envVar]) return env;
        }
        const v = find(envVar);
        if (v) return secretEnv(v.type, envVar, v.value);
        const fromServer = server(envVar);
        return fromServer === undefined ? undefined : { [envVar]: fromServer };
      },
    };
  }

  modelKeys(teamId: string): Record<ModelKeyProvider, { set: boolean; updatedAt?: string; updatedBy?: string }> {
    return Object.fromEntries(
      Object.entries(MODEL_KEYS).map(([p, k]) => {
        const m = this.getMeta("team", teamId, k.name);
        return [p, { set: Boolean(m), updatedAt: m?.updatedAt, updatedBy: m?.updatedBy }];
      }),
    ) as Record<ModelKeyProvider, { set: boolean; updatedAt?: string; updatedBy?: string }>;
  }

  setModelKey(teamId: string, provider: ModelKeyProvider, value: unknown, by: string): SecretMeta {
    const spec = MODEL_KEYS[provider];
    const type: SecretType = provider === "bedrock" && (typeof value === "string" || (typeof value === "object" && value !== null && "apiKey" in value)) ? "anthropic_bedrock_api_key" : spec.type;
    const existing = this.getMeta("team", teamId, spec.name);
    if (existing && existing.type !== type) this.k.store.delete(P.secrets, existing.id);
    return this.set({ scope: "team", owner: teamId, name: spec.name, type, value, description: `Team-managed ${provider} key` }, by);
  }

  /** Every secret value a run could have been given, for output redaction. */
  values(scope: SecretScope): string[] {
    const out: string[] = [];
    for (const s of this.k.store.list<ManagedSecret>(P.secrets, (x) => (x.scope === "team" && x.owner === scope.teamId) || (x.scope === "personal" && x.owner === scope.userId))) {
      const v = this.unseal(s.value);
      if (typeof v === "string") out.push(v);
      else if (v && typeof v === "object") {
        const o = v as Record<string, unknown>;
        for (const key of ["password", "apiKey", "accessKeyId", "secretAccessKey", "sessionToken"]) if (typeof o[key] === "string") out.push(o[key] as string);
      }
    }
    return out.filter((x) => x.length >= 6);
  }
}
