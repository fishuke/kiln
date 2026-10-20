"use server";

import { revalidatePath } from "next/cache";
import { stringify } from "yaml";
import { patchYaml } from "@/lib/frontmatter";
import { deleteFactory, migrateFactoryToGithub, sendJson } from "@/lib/api/factory-admin";
import { readDefinitionFile, saveFiles, type FileChange, type SaveResult } from "@/lib/definition-write";
import { api } from "@/lib/kiln";

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
    image: input.image.trim(),
    platform: input.os === "linux" ? undefined : input.os,
    registryCredentialSecretName: input.registryCredentialSecretName || undefined,
    setupCommands: input.setupCommands.map((c) => c.trim()).filter(Boolean),
    failureSessionRetentionMinutes: input.keepSessionAfterFailure ? 30 : undefined,
    shape: input.vcpus && input.memoryGb ? { vcpus: input.vcpus, memoryGb: input.memoryGb } : undefined,
  };
  const content = existing !== undefined ? patchYaml(existing, patch) : stringify(Object.fromEntries(Object.entries({ backend: "docker", ...patch }).filter(([, v]) => v !== undefined)));
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

/** Creates a team secret (value is write-only). `PUT /api/v1/secrets/:name` exists; description goes along when supported. */
export async function createTeamSecret(input: { name: string; value: string; description?: string }): Promise<{ ok: boolean; error?: string }> {
  const name = input.name.trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return { ok: false, error: "Use letters, digits and underscores, e.g. OPENAI_API_KEY." };
  if (!input.value) return { ok: false, error: "Enter a value." };
  const r = await sendJson("PUT", `/api/v1/secrets/${encodeURIComponent(name)}`, { value: input.value, description: input.description || undefined });
  if (!r.ok) {
    try {
      await api.setSecret(name, input.value);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : r.error };
    }
  }
  revalidatePath("/secrets");
  return { ok: true };
}

/** Registers MCP servers in the team registry (`POST /api/v1/mcp-servers`, coming) so agents can reference them by name. */
export async function createMcpServers(configs: Record<string, Record<string, unknown>>): Promise<{ ok: boolean; names: string[]; error?: string }> {
  const names: string[] = [];
  for (const [name, config] of Object.entries(configs)) {
    const r = await sendJson("POST", "/api/v1/mcp-servers", { name, ...config });
    if (!r.ok) return { ok: false, names, error: r.status === 404 ? "The MCP registry is not available on this Kiln server yet." : r.error };
    names.push(name);
  }
  revalidatePath("/mcps");
  return { ok: true, names };
}

export async function migrateToGithub(factory: string, owner: string, name: string): Promise<{ ok: boolean; error?: string; url?: string }> {
  const r = await migrateFactoryToGithub(factory, { owner, name });
  if (r.ok) {
    done(factory);
    return { ok: true, url: r.data.url ?? r.data.pullRequest };
  }
  if (r.status === 404) {
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
  return { ok: false, error: r.error };
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
  const r = await deleteFactory(factory);
  if (!r.ok) return { ok: false, error: r.status === 404 ? "Deleting factories is not available on this Kiln server yet." : r.error };
  revalidatePath("/", "layout");
  return { ok: true };
}
