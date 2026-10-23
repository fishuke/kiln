"use server";

import { revalidatePath } from "next/cache";
import type { VariableInput } from "@kiln/sdk-ts";
import { attempt, type ActionResult } from "@/lib/action-result";
import { api } from "@/lib/kiln";

/** The variable layers this editor owns: a project's or a Studio App's. */
export type EnvironmentScope = "project" | "app";

const pageOf = (scope: EnvironmentScope, owner: string) => (scope === "project" ? `/projects/${owner}` : `/studio/${owner}/settings`);

export async function saveVariables(scope: EnvironmentScope, owner: string, environment: string, variables: VariableInput[]): Promise<ActionResult> {
  const r = await attempt(() => api.setVariables(scope, owner, environment, variables), `Saved ${environment}`);
  if (r.ok) revalidatePath(pageOf(scope, owner));
  return r.ok ? { ok: true, message: r.message } : r;
}

export async function deleteEnvironment(scope: EnvironmentScope, owner: string, environment: string): Promise<ActionResult> {
  const r = await attempt(() => api.deleteVariables(scope, owner, environment), `Deleted ${environment}`);
  if (r.ok) revalidatePath(pageOf(scope, owner));
  return r.ok ? { ok: true, message: r.message } : r;
}
