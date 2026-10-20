import { KilnApiError } from "@kiln/sdk-ts";

/** True when an API call failed because the endpoint does not exist on this server yet (404 text body, 405, 501). */
export function isMissingEndpoint(e: unknown): boolean {
  if (e instanceof KilnApiError) return [404, 405, 501].includes(e.status);
  // The SDK parses every body as JSON; an unknown route answers with a plain-text 404.
  return e instanceof SyntaxError;
}
