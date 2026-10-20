import "server-only";
import { KilnClient } from "@kiln/sdk-ts";

/** Server-side client. The token never reaches the browser. */
export const api = new KilnClient({
  baseUrl: process.env.KILN_API_URL ?? "http://localhost:4000",
  token: process.env.KILN_TOKEN,
});

export async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}
