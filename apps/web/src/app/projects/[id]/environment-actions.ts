"use server";

import { revalidatePath } from "next/cache";
import type { VariableInput } from "@kiln/sdk-ts";
import { attempt, type ActionResult } from "@/lib/action-result";
import { api } from "@/lib/kiln";

export async function saveProjectVariables(projectId: string, environment: string, variables: VariableInput[]): Promise<ActionResult> {
  const r = await attempt(() => api.setVariables("project", projectId, environment, variables), `Saved ${environment}`);
  if (r.ok) revalidatePath(`/projects/${projectId}`);
  return r.ok ? { ok: true, message: r.message } : r;
}

export async function deleteProjectEnvironment(projectId: string, environment: string): Promise<ActionResult> {
  const r = await attempt(() => api.deleteVariables("project", projectId, environment), `Deleted ${environment}`);
  if (r.ok) revalidatePath(`/projects/${projectId}`);
  return r.ok ? { ok: true, message: r.message } : r;
}
