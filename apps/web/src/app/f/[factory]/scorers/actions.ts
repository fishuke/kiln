"use server";

import { revalidatePath } from "next/cache";
import { isMissingEndpoint } from "@/lib/api/missing";
import { api } from "@/lib/kiln";
import { DEFAULT_SCORERS, defaultScorerAgents, newScorerSlug, parseScorer, scorerPath, scorerProblems, scorerSlugs, serializeScorer, type ScorerModel } from "@/lib/scorers";
import { failure, write, type ActionResult, type WriteResult } from "@/lib/write-result";

const refresh = (factory: string) => revalidatePath(`/f/${factory}`, "layout");

export async function saveScorer(factory: string, original: string | null, model: ScorerModel): Promise<WriteResult & { slug?: string }> {
  const problems = Object.values(scorerProblems(model));
  if (problems.length) return { ok: false, error: problems[0]!, errors: problems };
  try {
    const def = await api.definition(factory);
    if (original) {
      const path = scorerPath(def.tree, original);
      if (!path) return { ok: false, error: `Scorer ${original} no longer exists` };
      const r = await write(factory, [{ path, content: serializeScorer({ ...model, slug: original }) }], `Update scorer ${model.name}`);
      refresh(factory);
      return { ...r, slug: original };
    }
    const existing = scorerSlugs(def.tree);
    const names = existing.map((s) => {
      try {
        return parseScorer(s, def.tree[`scorers/${s}/scorer.md`]!).name.toLowerCase();
      } catch {
        return s;
      }
    });
    if (names.includes(model.name.trim().toLowerCase())) return { ok: false, error: `A scorer named ${model.name} already exists.` };
    const slug = newScorerSlug(model.name, existing);
    const r = await write(factory, [{ path: `scorers/${slug}/scorer.md`, content: serializeScorer({ ...model, slug }) }], `Add scorer ${model.name}`);
    refresh(factory);
    return { ...r, slug };
  } catch (e) {
    return failure(e);
  }
}

export async function deleteScorer(factory: string, slug: string): Promise<WriteResult> {
  try {
    const def = await api.definition(factory);
    const path = scorerPath(def.tree, slug);
    if (!path) return { ok: false, error: `Scorer ${slug} no longer exists` };
    const r = await write(factory, [{ path, content: null }], `Delete scorer ${slug}`);
    refresh(factory);
    return r;
  } catch (e) {
    return failure(e);
  }
}

/** Add built-in scorers that the factory does not have yet. */
export async function addDefaultScorers(factory: string, slugs: string[], model: string): Promise<WriteResult> {
  try {
    const [def, f] = await Promise.all([api.definition(factory), api.factory(factory)]);
    const existing = scorerSlugs(def.tree);
    const changes = DEFAULT_SCORERS.filter((d) => slugs.includes(d.slug) && !existing.includes(d.slug)).map((d) => ({
      path: `scorers/${d.slug}/scorer.md`,
      content: serializeScorer({ ...d, model, agents: defaultScorerAgents(d.slug, f.agents).map((name) => ({ name, includeDescendants: false })), extra: {} }),
    }));
    if (!changes.length) return { ok: false, error: "Those scorers already exist." };
    const r = await write(factory, changes, `Add built-in scorers: ${changes.map((c) => c.path.split("/")[1]).join(", ")}`);
    refresh(factory);
    return r;
  } catch (e) {
    return failure(e);
  }
}

/** Score (or re-score) a run with one scorer; a re-score replaces the previous result. */
export async function rescoreRun(factory: string, scorer: string, runId: string): Promise<ActionResult> {
  try {
    await api.scoreRuns(factory, scorer, [runId]);
  } catch (e) {
    return isMissingEndpoint(e) ? { ok: false, error: "On-demand scoring is not available on this server yet." } : failure(e);
  }
  refresh(factory);
  return { ok: true };
}
