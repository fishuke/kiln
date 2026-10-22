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
  apps = async () => (await unwrap(actions.studioProjects())).projects;
  createApp: StudioClient["createApp"] = (input) => unwrap(actions.studioCreateProject(input));
  app = async (id: string) => {
    const { project, chats, versions } = await unwrap(actions.studioProject(id));
    return { app: project, chats, versions };
  };
  updateApp: StudioClient["updateApp"] = (id, patch) => unwrap(actions.studioUpdateProject(id, patch));
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
  saveSecrets = async (values: Record<string, string>) => {
    await unwrap(actions.studioSaveSecrets(values));
  };
}
