"use server";

import { revalidatePath } from "next/cache";
import { patchYaml } from "@/lib/frontmatter";
import type { McpServerInput } from "@kiln/sdk-ts";
import { connectionOptions, type ChannelOption, type OptionKind } from "@/lib/api/factory-admin";
import { isMissingEndpoint } from "@/lib/api/missing";
import { readDefinitionFile, saveFiles, type FileChange, type SaveResult } from "@/lib/definition-write";
import { api, errorMessage } from "@/lib/kiln";

const done = (factory: string) => revalidatePath(`/f/${factory}`, "layout");

/**
 * Patches factory.yaml. Keys are dotted paths (`agentDefaults.runner`); `undefined` deletes a key and
 * its empty parents, `null` writes YAML null (clears an inherited value).
 */
export async function saveFactoryYaml(factory: string, patch: Record<string, unknown>, message = "Update factory settings"): Promise<SaveResult> {
  const current = (await readDefinitionFile(factory, "factory.yaml")) ?? "";
  const r = await saveFiles(factory, [{ path: "factory.yaml", content: patchYaml(current, patch) }], message);
  if (r.ok) done(factory);
  return r;
}

export type RunnerInput = {
  name: string;
  description?: string;
  os: "linux" | "macos" | "windows";
  image: string;
  registryCredentialSecretName?: string;
  setupCommands: string[];
  keepSessionAfterFailure: boolean;
  vcpus?: number;
  memoryGb?: number;
  makeDefault?: boolean;
};

/** Writes runners/<name>.yaml (keeping keys the dialog does not edit) and optionally makes it the default. */
export async function saveRunner(factory: string, input: RunnerInput, isNew: boolean): Promise<SaveResult> {
  const name = input.name.trim();
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) return { ok: false, error: "Use lowercase letters, digits and dashes for the runner name." };
  const path = `runners/${name}.yaml`;
  const existing = await readDefinitionFile(factory, path);
  if (isNew && existing !== undefined) return { ok: false, error: `A runner named ${name} already exists.` };
  const patch: Record<string, unknown> = {
    description: input.description?.trim() || undefined,
    image: input.image.trim() || undefined,
    // Only platform.os: an existing platform.linux block (image, pull credential) is kept.
    "platform.os": input.os === "linux" ? undefined : input.os,
    registryCredentialSecretName: input.registryCredentialSecretName || undefined,
    setupCommands: input.setupCommands.map((c) => c.trim()).filter(Boolean),
    failureSessionRetentionMinutes: input.keepSessionAfterFailure ? 30 : undefined,
    shape: input.vcpus && input.memoryGb ? { vcpus: input.vcpus, memoryGb: input.memoryGb } : undefined,
  };
  const content = patchYaml(existing ?? "backend: docker\n", patch);
  const changes: FileChange[] = [{ path, content }];
  if (input.makeDefault) {
    const fy = (await readDefinitionFile(factory, "factory.yaml")) ?? "";
    changes.push({ path: "factory.yaml", content: patchYaml(fy, { "agentDefaults.runner": name }) });
  }
  const r = await saveFiles(factory, changes, `${isNew ? "Add" : "Update"} runner ${name}`);
  if (r.ok) done(factory);
  return r;
}

export async function deleteRunner(factory: string, name: string): Promise<SaveResult> {
  const r = await saveFiles(factory, [{ path: `runners/${name}.yaml`, content: null }], `Remove runner ${name}`);
  if (r.ok) done(factory);
  return r;
}

/**
 * Creates a team secret (value is write-only) with `PUT /api/v1/secrets/:name`. That route takes no
 * description; it is added to the team's managed secret afterwards when there is one.
 */
export async function createTeamSecret(input: { name: string; value: string; description?: string }): Promise<{ ok: boolean; error?: string }> {
  const name = input.name.trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return { ok: false, error: "Use letters, digits and underscores, e.g. OPENAI_API_KEY." };
  if (!input.value) return { ok: false, error: "Enter a value." };
  try {
    const r = (await api.setSecret(name, input.value)) as { ok: true; scope?: string };
    if (input.description && r.scope === "team") await api.updateManagedSecret("team", name, { description: input.description }).catch(() => undefined);
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
  revalidatePath("/secrets");
  return { ok: true };
}

/** Registers MCP servers in the team registry (`POST /api/v1/mcp-servers`) so agents can reference them by name. */
export async function createMcpServers(configs: Record<string, Record<string, unknown>>): Promise<{ ok: boolean; names: string[]; error?: string }> {
  const names: string[] = [];
  for (const [name, c] of Object.entries(configs)) {
    const input = { name, description: c.description, mode: c.mode, command: c.command, args: c.args, env: c.env, url: c.url, headers: c.headers } as McpServerInput;
    try {
      await api.createMcpServer(input);
    } catch (e) {
      return { ok: false, names, error: isMissingEndpoint(e) ? "The MCP registry is not available on this Kiln server yet." : errorMessage(e) };
    }
    names.push(name);
  }
  revalidatePath("/mcps");
  return { ok: true, names };
}

/** Channels, teams, projects, repositories or orgs a workspace connection (keyed by provider) offers. */
export async function loadConnectionOptions(provider: string, kind: OptionKind): Promise<ChannelOption[]> {
  return connectionOptions(provider, kind);
}

/** Uploads a file (`POST /api/v1/uploads`, multipart) and returns its key, served at /files/<key>. */
export async function uploadFile(form: FormData): Promise<{ ok: true; key: string } | { ok: false; error: string }> {
  try {
    const data = await api.request<{ key: string }>("POST", "/api/v1/uploads", form);
    return { ok: true, key: data.key };
  } catch (e) {
    return { ok: false, error: isMissingEndpoint(e) ? "Uploads are not available on this Kiln server yet." : errorMessage(e) };
  }
}

export async function migrateToGithub(factory: string, owner: string, name: string): Promise<{ ok: boolean; error?: string; url?: string }> {
  try {
    const r = await api.migrateFactory(factory, { owner, name });
    done(factory);
    return { ok: true, url: r.prUrl };
  } catch (e) {
    if (!isMissingEndpoint(e)) return { ok: false, error: errorMessage(e) };
  }
  // Older servers: connect an existing repo that already holds the definition.
  try {
    const c = await api.connect({ owner, name });
    if (c.ok) {
      done(factory);
      return { ok: true };
    }
    return { ok: false, error: c.errors[0] ?? "The repository does not hold a valid definition yet." };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function syncNow(factory: string): Promise<{ ok: boolean; error?: string; sha?: string }> {
  try {
    const r = await api.sync(factory);
    done(factory);
    return r.ok ? { ok: true, sha: r.sha } : { ok: false, error: r.errors[0] };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function canaryAction(factory: string, action: "promote" | "rollback"): Promise<{ ok: boolean; error?: string }> {
  try {
    await api.canary(factory, action);
    done(factory);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function removeFactory(factory: string): Promise<{ ok: boolean; error?: string }> {
  try {
    await api.deleteFactory(factory);
  } catch (e) {
    return { ok: false, error: isMissingEndpoint(e) ? "Deleting factories is not available on this Kiln server yet." : errorMessage(e) };
  }
  revalidatePath("/", "layout");
  return { ok: true };
}
