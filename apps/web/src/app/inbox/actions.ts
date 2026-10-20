"use server";

import { revalidatePath } from "next/cache";
import { api } from "@/lib/kiln";

/**
 * Read, unread and resolve go to POST /api/v1/inbox/read|unread|resolve with the API's item ids
 * (bare gate ids work for open gates). When the call fails the page keeps the change for this
 * visit only and says so (`stored: false`).
 */
export async function markItems(action: "read" | "unread" | "resolve", ids: string[]): Promise<{ ok: true; stored: boolean }> {
  try {
    const r = action === "read" ? await api.markRead(ids) : action === "unread" ? await api.markUnread(ids) : await api.resolveInbox(ids);
    revalidatePath("/inbox");
    revalidatePath("/", "layout");
    return { ok: true, stored: r.results.every((x) => x.ok) };
  } catch {
    return { ok: true, stored: false };
  }
}
