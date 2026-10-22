"use server";

import type { StudioDefinitionSaved, StudioDefinitionScope, StudioSettingsPatch } from "@kiln/sdk-ts";
import { attempt, type ActionResult } from "@/lib/action-result";
import { api } from "@/lib/kiln";

/** Saves a change to one definition layer (an App's own, a Kiln Project's or the team's). */
export async function saveStudioSettings(scope: StudioDefinitionScope, patch: StudioSettingsPatch): Promise<ActionResult<StudioDefinitionSaved>> {
  return attempt(() => api.studioEditDefinition(scope, patch), "Saved");
}

/** Points the layer back at an earlier version from its history. */
export async function restoreStudioDefinition(scope: StudioDefinitionScope, sha: string): Promise<ActionResult<StudioDefinitionSaved>> {
  return attempt(() => api.studioUseDefinition(scope, sha), `Using ${sha.slice(0, 7)}`);
}
