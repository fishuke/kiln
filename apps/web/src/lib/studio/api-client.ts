import * as actions from "@/app/studio/actions";
import type { StudioResult } from "@/app/studio/actions";
import { StudioClientError, type StudioClient } from "./client";

async function unwrap<T>(p: Promise<StudioResult<T>>): Promise<T> {
  const r = await p;
  if (!r.ok) throw new StudioClientError(r.error, r.status);
  return r.data;
}

/** The Studio routes through server actions, as the signed-in user. The page polls; there is no push. */
export class ApiStudioClient implements StudioClient {
  readonly kind = "api" as const;
  apps = async () => (await unwrap(actions.studioApps())).apps;
  createApp: StudioClient["createApp"] = (input) => unwrap(actions.studioCreateApp(input));
  app = (id: string) => unwrap(actions.studioApp(id));
  updateApp: StudioClient["updateApp"] = (id, patch) => unwrap(actions.studioUpdateApp(id, patch));
  newChat: StudioClient["newChat"] = (appId, input) => unwrap(actions.studioNewChat(appId, input));
  chat = (id: string) => unwrap(actions.studioChat(id));
  send: StudioClient["send"] = (chatId, input) => unwrap(actions.studioSend(chatId, input));
  apply = (chatId: string) => unwrap(actions.studioApply(chatId));
  chatDiff = (chatId: string) => unwrap(actions.studioChatDiff(chatId));
  chatPreview = (chatId: string) => unwrap(actions.studioChatPreview(chatId));
  restore = (versionId: string) => unwrap(actions.studioRestore(versionId));
  bookmark = (versionId: string, on: boolean) => unwrap(actions.studioBookmark(versionId, on));
  versionDiff = (versionId: string) => unwrap(actions.studioVersionDiff(versionId));
  versionPreview = (versionId: string) => unwrap(actions.studioVersionPreview(versionId));
  status = () => unwrap(actions.studioStatus());
  repositories = () => unwrap(actions.studioRepositories());
  ship: StudioClient["ship"] = (appId, input) => unwrap(actions.studioShip(appId, input));
  /** An API without the reviews route shows no Studio reviews in the Inbox. */
  reviews = async () => {
    const r = await actions.studioReviews();
    return r.ok ? r.data.reviews : [];
  };
  followup = async (runId: string, text: string) => {
    await unwrap(actions.studioFollowup(runId, text));
  };
  interrupt = async (runId: string) => {
    await unwrap(actions.studioInterrupt(runId));
  };
  saveSecrets = async (values: Record<string, string>) => {
    await unwrap(actions.studioSaveSecrets(values));
  };
}
