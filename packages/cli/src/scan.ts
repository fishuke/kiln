// kiln scan: an offline, deterministic profile of a repository, the evidence base for the Factory Architect.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type RepoProfile = {
  languages: string[];
  packageManager?: string;
  commands: { install?: string; test?: string; lint?: string; typecheck?: string; build?: string };
  ci?: { provider: string; files: string[] };
  agentInstructions: string[];
  mcpSuggestions: { server: string; evidence: string }[];
  runner: string;
};

const LANGS: [string, string][] = [
  ["package.json", "javascript"],
  ["pyproject.toml", "python"],
  ["requirements.txt", "python"],
  ["go.mod", "go"],
  ["Cargo.toml", "rust"],
  ["Gemfile", "ruby"],
  ["pom.xml", "java"],
  ["build.gradle", "java"],
  ["build.gradle.kts", "kotlin"],
  ["composer.json", "php"],
];
const LOCKS: [string, string][] = [
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["bun.lockb", "bun"],
  ["bun.lock", "bun"],
  ["package-lock.json", "npm"],
  ["uv.lock", "uv"],
  ["poetry.lock", "poetry"],
  ["Pipfile.lock", "pipenv"],
  ["go.sum", "go"],
  ["Cargo.lock", "cargo"],
  ["Gemfile.lock", "bundler"],
];
const INSTALL: Record<string, string> = {
  pnpm: "pnpm install --frozen-lockfile",
  yarn: "yarn install --immutable",
  bun: "bun install --frozen-lockfile",
  npm: "npm ci",
  uv: "uv sync",
  poetry: "poetry install",
  pipenv: "pipenv install --dev",
  pip: "pip install -r requirements.txt",
  go: "go mod download",
  cargo: "cargo fetch",
  bundler: "bundle install",
};
const DEFAULT_TEST: Record<string, string> = {
  uv: "uv run pytest",
  poetry: "poetry run pytest",
  pipenv: "pipenv run pytest",
  pip: "pytest",
  go: "go test ./...",
  cargo: "cargo test",
  bundler: "bundle exec rspec",
};
const DEFAULT_LINT: Record<string, string> = { go: "go vet ./...", cargo: "cargo clippy -- -D warnings" };
// Dependency or config hints that a team uses a tool the factory's agents should reach through MCP.
const MCP_HINTS: [RegExp, string][] = [
  [/(^|["'\s/])(@sentry\/[\w-]+|sentry-sdk|sentry-go|sentry-ruby|sentry)(["'\s=<>~^]|$)/, "sentry"],
  [/(^|["'\s/])(@grafana\/[\w-]+|grafana|loki|@opentelemetry\/[\w-]+)(["'\s=<>~^]|$)/, "grafana"],
  [/(^|["'\s/])(dd-trace|datadog|ddtrace|@datadog\/[\w-]+)(["'\s=<>~^]|$)/, "datadog"],
  [/(^|["'\s/])(@linear\/sdk)(["'\s=<>~^]|$)/, "linear"],
  [/(^|["'\s/])(jira-client|jira\.js|jira)(["'\s=<>~^]|$)/, "jira"],
  [/(^|["'\s/])(@slack\/[\w-]+|slack-sdk|slack_sdk)(["'\s=<>~^]|$)/, "slack"],
  [/(^|["'\s/])(posthog-js|posthog-node|posthog)(["'\s=<>~^]|$)/, "posthog"],
  [/(^|["'\s/])(stripe)(["'\s=<>~^]|$)/, "stripe"],
  [/(^|["'\s/])(@supabase\/[\w-]+|supabase)(["'\s=<>~^]|$)/, "supabase"],
];
const AGENT_FILES = ["CLAUDE.md", "AGENTS.md", "GEMINI.md", ".github/copilot-instructions.md", ".cursorrules", ".cursor/rules"];

const read = (dir: string, f: string) => {
  try {
    return readFileSync(join(dir, f), "utf8");
  } catch {
    return "";
  }
};
const list = (dir: string, sub: string) => {
  try {
    return readdirSync(join(dir, sub))
      .filter((f) => /\.ya?ml$/.test(f))
      .sort()
      .map((f) => `${sub}/${f}`);
  } catch {
    return [];
  }
};

export function scanRepo(dir: string): RepoProfile {
  const has = (f: string) => existsSync(join(dir, f));
  const languages = [...new Set(LANGS.filter(([f]) => has(f)).map(([, l]) => l))];
  const pkg = has("package.json")
    ? (JSON.parse(read(dir, "package.json") || "{}") as {
        scripts?: Record<string, string>;
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      })
    : undefined;
  if (pkg && (has("tsconfig.json") || pkg.devDependencies?.typescript || pkg.dependencies?.typescript || pkg.scripts?.typecheck))
    languages.splice(languages.indexOf("javascript"), 1, "typescript");
  let packageManager = LOCKS.find(([f]) => has(f))?.[1];
  if (!packageManager && has("requirements.txt")) packageManager = "pip";
  if (!packageManager && pkg) packageManager = "npm";

  const commands: RepoProfile["commands"] = {};
  if (packageManager) commands.install = INSTALL[packageManager];
  const scripts = pkg?.scripts ?? {};
  const run = (s: string) => (packageManager === "npm" ? (s === "test" ? "npm test" : `npm run ${s}`) : `${packageManager} ${s}`);
  for (const [key, names] of [
    ["test", ["test"]],
    ["lint", ["lint"]],
    ["typecheck", ["typecheck", "type-check", "tsc"]],
    ["build", ["build"]],
  ] as const) {
    const name = names.find((n) => scripts[n]);
    if (name && pkg) commands[key] = run(name);
  }
  if (!commands.test && packageManager && DEFAULT_TEST[packageManager]) commands.test = DEFAULT_TEST[packageManager];
  if (!commands.lint && packageManager && DEFAULT_LINT[packageManager]) commands.lint = DEFAULT_LINT[packageManager];

  let ci: RepoProfile["ci"];
  const gh = list(dir, ".github/workflows");
  if (gh.length) ci = { provider: "github-actions", files: gh };
  else if (has(".gitlab-ci.yml")) ci = { provider: "gitlab-ci", files: [".gitlab-ci.yml"] };
  else if (has(".circleci/config.yml")) ci = { provider: "circleci", files: [".circleci/config.yml"] };
  else if (has("azure-pipelines.yml")) ci = { provider: "azure-pipelines", files: ["azure-pipelines.yml"] };

  const agentInstructions = AGENT_FILES.filter(has);

  const manifests: [string, string][] = [];
  if (pkg) for (const d of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })) manifests.push([d, `dependency ${d}`]);
  for (const f of ["pyproject.toml", "requirements.txt", "go.mod", "Gemfile", "Cargo.toml", "composer.json", "docker-compose.yml", "compose.yaml"])
    if (has(f)) manifests.push([read(dir, f), f]);
  const mcpSuggestions: RepoProfile["mcpSuggestions"] = [];
  for (const [re, server] of MCP_HINTS) {
    const hit = manifests.find(([text]) => re.test(text) || re.test(` ${text} `));
    if (hit && !mcpSuggestions.some((m) => m.server === server)) mcpSuggestions.push({ server, evidence: hit[1] });
  }

  const image = languages.includes("python")
    ? "Python 3.12"
    : languages.includes("go")
      ? "Go 1.23"
      : languages.includes("rust")
        ? "Rust stable"
        : languages.includes("ruby")
          ? "Ruby 3.3"
          : "Node 22";
  const setup = [packageManager === "pnpm" || packageManager === "yarn" ? "corepack enable" : undefined, commands.install].filter(Boolean);
  const runner =
    [
      `description: Linux sandbox with ${image}${packageManager ? ` and ${packageManager}` : ""}`,
      "backend: docker",
      "shape: { vcpus: 4, memoryGb: 8 }",
      ...(setup.length ? ["setupCommands:", ...setup.map((c) => `  - ${c}`)] : []),
    ].join("\n") + "\n";

  return { languages, packageManager, commands, ci, agentInstructions, mcpSuggestions, runner };
}

export function formatProfile(p: RepoProfile): string {
  const lines = [
    `languages      ${p.languages.join(", ") || "–"}`,
    `package mgr    ${p.packageManager ?? "–"}`,
    ...Object.entries(p.commands).map(([k, v]) => `${k.padEnd(14)} ${v}`),
    `ci             ${p.ci ? `${p.ci.provider} (${p.ci.files.join(", ")})` : "–"}`,
    `instructions   ${p.agentInstructions.join(", ") || "–"}`,
    `mcp servers    ${p.mcpSuggestions.map((m) => `${m.server} (${m.evidence})`).join(", ") || "–"}`,
  ];
  return lines.join("\n");
}
