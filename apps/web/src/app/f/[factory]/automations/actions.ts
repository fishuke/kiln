"use server";

import { revalidatePath } from "next/cache";
import { isMissingEndpoint } from "@/lib/api/missing";
import { runAutomation, testFilter, type FilterTestResult } from "@/lib/api/automations";
import { webhookDeliveries, type Delivery } from "@/lib/api/webhooks";
import { automationPath, parseAutomation, serializeAutomation, serializeTrigger, type AutomationModel, type TriggerModel } from "@/lib/automations/model";
import { resourceName } from "@/lib/frontmatter";
import { api } from "@/lib/kiln";
import { failure, write, type ActionResult, type WriteResult } from "@/lib/write-result";

const refresh = (factory: string) => revalidatePath(`/f/${factory}`, "layout");

async function load(factory: string, name: string) {
  const def = await api.definition(factory);
  const path = automationPath(def.tree, name);
  if (!path) throw new Error(`Automation ${name} no longer exists`);
  return { path, model: parseAutomation(name, def.tree[path]!) };
}

/** Create (original null) or update an automation file. Returns the automation's name (its directory). */
export async function saveAutomation(factory: string, original: string | null, model: AutomationModel): Promise<WriteResult & { name?: string }> {
  try {
    if (!model.triggers.length) return { ok: false, error: "Add at least one trigger." };
    if (original) {
      const { path } = await load(factory, original);
      const r = await write(factory, [{ path, content: serializeAutomation({ ...model, name: original }) }], `Update automation ${original}`);
      refresh(factory);
      return { ...r, name: original };
    }
    const name = resourceName(model.name);
    if (!name) return { ok: false, error: "Name is required." };
    const def = await api.definition(factory);
    if (automationPath(def.tree, name)) return { ok: false, error: `An automation named ${name} already exists.` };
    const r = await write(factory, [{ path: `automations/${name}/automation.md`, content: serializeAutomation({ ...model, name }) }], `Add automation ${name}`);
    refresh(factory);
    return { ...r, name };
  } catch (e) {
    return failure(e);
  }
}

async function patch(factory: string, name: string, fn: (m: AutomationModel) => AutomationModel, message: string): Promise<WriteResult> {
  try {
    const { path, model } = await load(factory, name);
    const r = await write(factory, [{ path, content: serializeAutomation(fn(model)) }], message);
    refresh(factory);
    return r;
  } catch (e) {
    return failure(e);
  }
}

export async function setAutomationEnabled(factory: string, name: string, enabled: boolean): Promise<WriteResult> {
  return patch(factory, name, (m) => ({ ...m, enabled }), `${enabled ? "Resume" : "Pause"} automation ${name}`);
}

export async function renameAutomation(factory: string, name: string, displayName: string): Promise<WriteResult> {
  const d = displayName.trim();
  return patch(factory, name, (m) => ({ ...m, displayName: d && d !== name ? d : undefined }), `Rename automation ${name}`);
}

export async function deleteAutomation(factory: string, name: string): Promise<WriteResult> {
  try {
    const { path } = await load(factory, name);
    const r = await write(factory, [{ path, content: null }], `Delete automation ${name}`);
    refresh(factory);
    return r;
  } catch (e) {
    return failure(e);
  }
}

/** Start the automation now. Falls back to sending its prompt to the factory when the run endpoint is missing. */
export async function runAutomationNow(factory: string, name: string): Promise<ActionResult<{ href?: string; fallback?: boolean }>> {
  try {
    const r = await runAutomation(factory, name);
    refresh(factory);
    return { ok: true, href: r.workItemId ? `/runs/${r.workItemId}` : r.runId ? `/runs/${r.runId}` : undefined };
  } catch (e) {
    if (!isMissingEndpoint(e)) return failure(e);
  }
  try {
    const { model } = await load(factory, name);
    const wi = await api.send({ factory, title: model.displayName || model.name, body: model.prompt || `Run the ${model.name} automation.` });
    refresh(factory);
    return { ok: true, href: `/runs/${wi.id}`, fallback: true };
  } catch (e) {
    return failure(e);
  }
}

export async function recentDeliveries(factory: string, webhook: string): Promise<Delivery[]> {
  return webhookDeliveries(factory, webhook);
}

export async function testAutomationFilter(factory: string, name: string, trigger: TriggerModel, deliveryId?: string): Promise<ActionResult<{ result: FilterTestResult }>> {
  try {
    return { ok: true, result: await testFilter(factory, name, { trigger: serializeTrigger(trigger), deliveryId }) };
  } catch (e) {
    if (isMissingEndpoint(e)) return { ok: false, error: "Filter testing is not available on this server yet." };
    return failure(e);
  }
}
