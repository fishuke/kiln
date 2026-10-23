import * as actions from "@/app/studio/actions";
import type { StudioResult } from "@/app/studio/actions";
import { StudioClientError, type StudioClient } from "./client";

async function unwrap<T>(p: Promise<StudioResult<T>>): Promise<T> {
  const r = await p;
  if (!r.ok) throw new StudioClientError(r.error, r.status);
  return r.data;
}

/** The Studio routes through server actions (the SDK, as the signed-in user); chats update over SSE. */
export class ApiStudioClient implements StudioClient {
  readonly kind = "api" as const;
  apps = async () => (await unwrap(actions.studioApps())).apps;
  createApp: StudioClient["createApp"] = (input) => unwrap(actions.studioCreateApp(input));
  app = (id: string) => unwrap(actions.studioApp(id));
  updateApp: StudioClient["updateApp"] = (id, patch) => unwrap(actions.studioUpdateApp(id, patch));
  setShipMode: StudioClient["setShipMode"] = (id, mode) => unwrap(actions.studioSetShipMode(id, mode));
  retryApp = (id: string) => unwrap(actions.studioRetryApp(id));
  deleteApp = async (id: string) => {
    await unwrap(actions.studioDeleteApp(id));
  };
  newChat: StudioClient["newChat"] = (appId, input) => unwrap(actions.studioNewChat(appId, input));
  chat = (id: string) => unwrap(actions.studioChat(id));
  deleteChat = async (id: string) => {
    await unwrap(actions.studioDeleteChat(id));
  };
  send: StudioClient["send"] = (chatId, input) => unwrap(actions.studioSend(chatId, input));
  apply = (chatId: string) => unwrap(actions.studioApply(chatId));
  chatDiff = (chatId: string) => unwrap(actions.studioChatDiff(chatId));
  chatPreview = (chatId: string) => unwrap(actions.studioChatPreview(chatId));
  restartChatPreview = (chatId: string) => unwrap(actions.studioRestartChatPreview(chatId));
  restore = (versionId: string) => unwrap(actions.studioRestore(versionId));
  bookmark = (versionId: string, on: boolean) => unwrap(actions.studioBookmark(versionId, on));
  versionDiff = (versionId: string) => unwrap(actions.studioVersionDiff(versionId));
  versionPreview = (versionId: string) => unwrap(actions.studioVersionPreview(versionId));
  restartVersionPreview = (versionId: string) => unwrap(actions.studioRestartVersionPreview(versionId));
  status = () => unwrap(actions.studioStatus());
  repositories = () => unwrap(actions.studioRepositories());
  ship: StudioClient["ship"] = (appId, input) => unwrap(actions.studioShip(appId, input));
  mergeReviews: StudioClient["mergeReviews"] = async (state) => (await unwrap(actions.studioMergeReviews(state))).reviews;
  decideApproval: StudioClient["decideApproval"] = async (gateId, decision) => {
    await unwrap(actions.studioDecideApproval(gateId, decision));
  };
  interrupt = async (runId: string) => {
    await unwrap(actions.studioInterrupt(runId));
  };

  /** `GET /studio/chats/{id}/events` through the web's streaming proxy; `turn` and `chat` events mean "changed". */
  watchChat(chatId: string, onChange: () => void): () => void {
    if (typeof EventSource === "undefined") return () => undefined;
    const source = new EventSource(`/api/studio/chats/${encodeURIComponent(chatId)}/events`);
    source.addEventListener("turn", onChange);
    source.addEventListener("chat", onChange);
    return () => source.close();
  }
}
