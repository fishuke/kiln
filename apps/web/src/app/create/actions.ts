"use server";

import { revalidatePath } from "next/cache";
import { KilnApiError } from "@kiln/sdk-ts";
import { listConnections } from "@/lib/api/factory-admin";
import { isMissingEndpoint } from "@/lib/api/missing";
import { validateAlias } from "@/lib/alias";
import { buildFactoryTree, toCreateFactoryInput, type WizardInput } from "@/lib/factory-template";
import { api, errorMessage } from "@/lib/kiln";

export type CreateResult = { ok: true; factory: string; workItem?: string } | { ok: false; error: string; errors?: string[] };

/**
 * Creates the factory with `POST /api/v1/factories` when its wizard can express the input; otherwise
 * (or on servers without it) builds the definition tree here and applies it with
 * `POST /api/v1/definitions/apply`. Then optionally starts the learning run and the first task.
 */
export async function createFactoryFromWizard(input: WizardInput, opts: { enableLearning: boolean; firstTask?: string }): Promise<CreateResult> {
  const taken = await api.factories().then((fs) => fs.map((f) => f.alias)).catch(() => [] as string[]);
  const aliasError = validateAlias(input.alias, taken);
  if (aliasError) return { ok: false, error: aliasError };
  if (!input.name.trim()) return { ok: false, error: "Enter a factory name." };

  let factory: string | undefined;
  let local = true;
  const create = toCreateFactoryInput(input);
  if (create) {
    try {
      factory = (await api.createFactory(create)).factory?.id;
      local = false;
    } catch (e) {
      if (!isMissingEndpoint(e)) {
        const b = e instanceof KilnApiError ? (e.body as { errors?: string[] } | undefined) : undefined;
        return { ok: false, error: errorMessage(e), errors: b?.errors };
      }
    }
  }
  if (local) {
    try {
      const r = await api.apply(buildFactoryTree(input));
      if (!r.ok) return { ok: false, error: r.errors[0] ?? "The generated definition is not valid", errors: r.errors };
      factory = r.factory;
    } catch (e) {
      const body = e instanceof KilnApiError ? (e.body as { errors?: string[]; error?: string } | undefined) : undefined;
      return { ok: false, error: body?.errors?.[0] ?? body?.error ?? (e instanceof Error ? e.message : String(e)), errors: body?.errors };
    }
  }
  factory ??= input.alias;

  let workItem: string | undefined;
  try {
    if (opts.enableLearning) {
      await api.send({
        factory,
        title: "Learn how this team works",
        body: "Research how the connected repositories, issue tracker and chat are set up (conventions, CI, review habits, labels). Propose memories and prompt changes for this factory; do not change application code.",
        via: "kiln",
      });
    }
    if (opts.firstTask?.trim()) {
      const [title, ...rest] = opts.firstTask.trim().split("\n");
      const wi = await api.send({ factory, title: title!.slice(0, 200), body: rest.join("\n").trim(), via: "kiln" });
      workItem = wi.id;
    }
  } catch {
    // The factory exists; starting work is best effort.
  }
  revalidatePath("/", "layout");
  return { ok: true, factory, workItem };
}

export type ConnectionCheck = { type: string; label: string; status: "ok" | "missing" | "failed"; detail?: string };

/** Checks every selected integration: a workspace connection exists and `POST /api/v1/connections/:provider/test` passes. */
export async function testConnections(types: string[]): Promise<ConnectionCheck[]> {
  const conns = await listConnections();
  const out: ConnectionCheck[] = [];
  for (const type of types) {
    const conn = conns.find((c) => c.provider === type || (type === "microsoft-teams" && c.provider === "teams"));
    const label = type.replace(/_/g, " ").replace(/-/g, " ");
    if (!conn) {
      out.push({ type, label, status: "missing", detail: "Not connected in this workspace yet." });
      continue;
    }
    try {
      const r = await api.testConnection(conn.provider);
      out.push(r.ok ? { type, label, status: "ok", detail: conn.account ?? conn.name } : { type, label, status: "failed", detail: r.message });
    } catch (e) {
      out.push({ type, label, status: "failed", detail: errorMessage(e) });
    }
  }
  return out;
}
