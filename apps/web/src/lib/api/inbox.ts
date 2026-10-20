import "server-only";
import { rawJson } from "./raw";

/** Coming: POST /api/v1/inbox/read|unread|resolve {ids}. */
export function markInbox(action: "read" | "unread" | "resolve", ids: string[]) {
  return rawJson<{ ok?: boolean }>("POST", `/api/v1/inbox/${action}`, { ids });
}
