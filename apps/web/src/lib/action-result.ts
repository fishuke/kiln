import "server-only";
import { errorMessage } from "./kiln";

/** What a server action hands back to a client form so it can toast. */
export type ActionResult<T = undefined> = { ok: true; message?: string; data?: T } | { ok: false; error: string };

/** Runs an API call and turns errors into `{ ok: false, error }` instead of throwing. */
export async function attempt<T>(fn: () => Promise<T>, message?: string): Promise<ActionResult<T>> {
  try {
    const data = await fn();
    return { ok: true, message, data };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}
