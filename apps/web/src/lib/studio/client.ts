import type {
  AppDetail,
  ApplyResult,
  ChatDetail,
  ChatMode,
  CreateAppInput,
  ForgeRepository,
  NewChatInput,
  NewChatResult,
  Preview,
  SendResult,
  StatusReport,
  StudioApp,
  UpdateAppInput,
  Version,
} from "./types";

/**
 * What the Studio page needs from the API, one method per route in docs/specs/studio.md (named like
 * the SDK's `studio*` methods, with "app" for the spec's "project"). `ApiStudioClient` calls the
 * routes through server actions; `FakeStudioClient` keeps everything in memory so the page runs
 * without a backend.
 */
export interface StudioClient {
  readonly kind: "api" | "fake";
  apps(): Promise<StudioApp[]>;
  createApp(input: CreateAppInput): Promise<StudioApp>;
  app(id: string): Promise<AppDetail>;
  updateApp(id: string, patch: UpdateAppInput): Promise<StudioApp>;
  newChat(appId: string, input: NewChatInput): Promise<NewChatResult>;
  chat(id: string): Promise<ChatDetail>;
  send(chatId: string, input: { text: string; mode?: ChatMode }): Promise<SendResult>;
  apply(chatId: string): Promise<ApplyResult>;
  chatDiff(chatId: string): Promise<{ diff: string }>;
  chatPreview(chatId: string): Promise<Preview>;
  restore(versionId: string): Promise<Version>;
  bookmark(versionId: string, on: boolean): Promise<Version>;
  versionDiff(versionId: string): Promise<{ diff: string }>;
  versionPreview(versionId: string): Promise<Preview>;
  status(): Promise<StatusReport>;
  /** Connected forge repositories, for "Import from GitHub". */
  repositories(): Promise<ForgeRepository[]>;
  /** Saves team secrets (an imported app's missing env); Studio reads them the next time the app opens. */
  saveSecrets(values: Record<string, string>): Promise<void>;
  /** Push updates (the fake); the API client polls instead. */
  subscribe?(listener: () => void): () => void;
}

/** Thrown by a client call; `status` is the HTTP status when the API answered. */
export class StudioClientError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "StudioClientError";
  }
}
