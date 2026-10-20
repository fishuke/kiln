"use server";

import { revalidatePath } from "next/cache";
import { agentPath, agentSlug, agentSourceFromForm, type AgentForm } from "@/lib/agent-file";
import { api } from "@/lib/kiln";
import { saveFiles, type SaveResult } from "@/lib/definition-write";

const done = (factory: string) => revalidatePath(`/f/${factory}`, "layout");

/** Writes agents/<name>/agent.md (frontmatter + prompt). New agents must not collide with existing ones. */
export async function saveAgent(factory: string, rawName: string, form: AgentForm, isNew: boolean): Promise<SaveResult & { name?: string }> {
  const name = isNew ? agentSlug(rawName) : rawName;
  if (!name) return { ok: false, error: "Enter an agent name." };
  const def = await api.definition(factory).catch(() => null);
  const existing = def?.tree[agentPath(name)];
  if (isNew && existing !== undefined) return { ok: false, error: `An agent named ${name} already exists.` };
  if (!form.prompt.trim()) return { ok: false, error: "Write a prompt for the agent." };
  const content = agentSourceFromForm(form, existing);
  const r = await saveFiles(factory, [{ path: agentPath(name), content }], `${isNew ? "Add" : "Update"} agent ${name}`);
  if (r.ok) done(factory);
  return { ...r, name };
}

/** Removes the agent directory (agent.md and its skills). */
export async function deleteAgent(factory: string, name: string): Promise<SaveResult> {
  const def = await api.definition(factory).catch(() => null);
  const paths = Object.keys(def?.tree ?? {}).filter((p) => p.startsWith(`agents/${name}/`));
  const r = await saveFiles(factory, (paths.length ? paths : [agentPath(name)]).map((path) => ({ path, content: null })), `Remove agent ${name}`);
  if (r.ok) done(factory);
  return r;
}

/** Copies the agent directory to a new name; the copy becomes a CUSTOM agent. */
export async function duplicateAgent(factory: string, name: string): Promise<SaveResult & { name?: string }> {
  const def = await api.definition(factory).catch(() => null);
  if (!def) return { ok: false, error: "The definition could not be read." };
  let copy = `${name}-copy`;
  for (let i = 2; Object.keys(def.tree).some((p) => p.startsWith(`agents/${copy}/`)); i++) copy = `${name}-copy-${i}`;
  const changes = Object.entries(def.tree)
    .filter(([p]) => p.startsWith(`agents/${name}/`))
    .map(([p, content]) => ({ path: p.replace(`agents/${name}/`, `agents/${copy}/`), content: p === agentPath(name) ? content.replace(/^(agentType:\s*)\w+/m, "$1CUSTOM") : content }));
  const r = await saveFiles(factory, changes, `Duplicate agent ${name} as ${copy}`);
  if (r.ok) done(factory);
  return { ...r, name: copy };
}
