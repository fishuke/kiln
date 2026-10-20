/** What each managed secret type holds and what a run gets from it (docs: Secrets, MCP servers and environments). */

export type SecretTypeId =
  | "raw"
  | "docker_registry"
  | "aws_ecr"
  | "anthropic_api_key"
  | "claude_oauth_token"
  | "chatgpt_auth"
  | "anthropic_bedrock_api_key"
  | "anthropic_bedrock_access_key"
  | "openai_api_key"
  | "openrouter_api_key"
  | "google_api_key";

export type SecretField = { key: string; label: string; placeholder?: string; secret?: boolean; optional?: boolean };

export type SecretTypeMeta = {
  id: SecretTypeId;
  label: string;
  group: "General" | "Image credentials" | "Harness credentials";
  /** Fields of an object value; absent means the value is one string. */
  fields?: SecretField[];
  placeholder?: string;
  /** What a run's environment gets; a function of the secret name for raw values. */
  gives: (name: string) => string;
  teamOnly?: boolean;
};

export const SECRET_TYPES: SecretTypeMeta[] = [
  { id: "raw", label: "Raw value", group: "General", placeholder: "Enter secret value", gives: (n) => `${n || "NAME"} as an environment variable` },
  {
    id: "docker_registry",
    label: "Private image credential",
    group: "Image credentials",
    fields: [
      { key: "host", label: "Registry host", placeholder: "ghcr.io" },
      { key: "username", label: "Username" },
      { key: "password", label: "Password or token", secret: true },
    ],
    gives: () => "Nothing in the environment. Runners use it to pull private images.",
  },
  {
    id: "aws_ecr",
    label: "AWS ECR credential",
    group: "Image credentials",
    teamOnly: true,
    fields: [
      { key: "roleArn", label: "Role ARN", placeholder: "arn:aws:iam::123456789012:role/kiln-ecr-pull" },
      { key: "region", label: "Region", placeholder: "eu-west-1" },
    ],
    gives: () => "Nothing in the environment. Runners use it to pull images from ECR.",
  },
  { id: "anthropic_api_key", label: "Anthropic API key", group: "Harness credentials", placeholder: "sk-ant-api03-…", gives: () => "ANTHROPIC_API_KEY" },
  { id: "claude_oauth_token", label: "Claude subscription token", group: "Harness credentials", placeholder: "Paste the token from `claude setup-token`", gives: () => "CLAUDE_CODE_OAUTH_TOKEN" },
  {
    id: "chatgpt_auth",
    label: "ChatGPT login (Codex)",
    group: "Harness credentials",
    placeholder: "Paste ~/.codex/auth.json, or use Sign in with ChatGPT under Team settings",
    gives: () => "Nothing in the environment. Codex runs get it as their auth.json.",
  },
  {
    id: "anthropic_bedrock_api_key",
    label: "Anthropic on Bedrock: API key",
    group: "Harness credentials",
    fields: [
      { key: "apiKey", label: "Bedrock API key", secret: true },
      { key: "region", label: "Region", placeholder: "us-east-1" },
    ],
    gives: () => "AWS_BEARER_TOKEN_BEDROCK, AWS_REGION, CLAUDE_CODE_USE_BEDROCK=1",
  },
  {
    id: "anthropic_bedrock_access_key",
    label: "Anthropic on Bedrock: access key",
    group: "Harness credentials",
    fields: [
      { key: "accessKeyId", label: "Access key ID" },
      { key: "secretAccessKey", label: "Secret access key", secret: true },
      { key: "sessionToken", label: "Session token", secret: true, optional: true },
      { key: "region", label: "Region", placeholder: "us-east-1" },
    ],
    gives: () => "AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_SESSION_TOKEN, AWS_REGION, CLAUDE_CODE_USE_BEDROCK=1",
  },
  { id: "openai_api_key", label: "OpenAI API key", group: "Harness credentials", placeholder: "sk-proj-…", gives: () => "OPENAI_API_KEY" },
  { id: "openrouter_api_key", label: "OpenRouter API key", group: "Harness credentials", placeholder: "sk-or-v1-…", gives: () => "OPENROUTER_API_KEY" },
  { id: "google_api_key", label: "Google API key", group: "Harness credentials", placeholder: "AIza…", gives: () => "GOOGLE_GENERATIVE_AI_API_KEY" },
];

export function secretType(id: string): SecretTypeMeta {
  return SECRET_TYPES.find((t) => t.id === id) ?? SECRET_TYPES[0]!;
}

/** Secret names: letters, digits and underscores, starting with a letter or underscore. */
export function validSecretName(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(name);
}

/** Turns "my api key" into "MY_API_KEY" as the user types. */
export function toSecretName(input: string): string {
  return input
    .toUpperCase()
    .replace(/[^A-Z0-9_]+/g, "_")
    .replace(/^([0-9])/, "_$1")
    .slice(0, 128);
}

/** Parses KEY=value lines (a .env file) for import. Comments and blank lines are skipped. */
export function parseDotenv(text: string): { name: string; value: string }[] {
  const out: { name: string; value: string }[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let value = m[2]!;
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (value) out.push({ name: m[1]!, value });
  }
  return out;
}
