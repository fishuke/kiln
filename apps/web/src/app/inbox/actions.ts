"use server";

import { revalidatePath } from "next/cache";
import { markInbox } from "@/lib/api/inbox";

/**
 * Read, unread and resolve go to POST /api/v1/inbox/read|unread|resolve. Until the API has
 * them the page keeps the change for this visit only and says so (`stored: false`).
 */
export async function markItems(action: "read" | "unread" | "resolve", ids: string[]): Promise<{ ok: true; stored: boolean }> {
  try {
    await markInbox(action, ids);
    revalidatePath("/inbox");
    revalidatePath("/", "layout");
    return { ok: true, stored: true };
  } catch {
    return { ok: true, stored: false };
  }
}
