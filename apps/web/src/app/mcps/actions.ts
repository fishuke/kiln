"use server";

import { revalidatePath } from "next/cache";
import type { McpServerInput } from "@kiln/sdk-ts";
import { attempt, type ActionResult } from "@/lib/action-result";
import { api } from "@/lib/kiln";

export async function createMcp(input: McpServerInput): Promise<ActionResult> {
  const r = await attempt(() => api.createMcpServer(input), `Added ${input.name}`);
  if (r.ok) revalidatePath("/mcps");
  return r.ok ? { ok: true, message: r.message } : r;
}

export async function updateMcp(id: string, patch: Partial<McpServerInput>): Promise<ActionResult> {
  const r = await attempt(() => api.updateMcpServer(id, patch), "MCP server saved");
  if (r.ok) revalidatePath("/mcps");
  return r.ok ? { ok: true, message: r.message } : r;
}

export async function deleteMcp(id: string, name: string): Promise<ActionResult> {
  const r = await attempt(() => api.deleteMcpServer(id), `Deleted ${name}`);
  if (r.ok) revalidatePath("/mcps");
  return r.ok ? { ok: true, message: r.message } : r;
}
