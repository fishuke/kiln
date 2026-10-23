import type {
  AppDetail,
  ApplyResult,
  AppPullRequest,
  ChatDetail,
  ChatMode,
  CreateAppInput,
  ForgeRepository,
  MergeReview,
  NewChatInput,
  NewChatResult,
  Preview,
  SendResult,
  StatusReport,
  ShipMode,
  StudioApp,
  UpdateAppInput,
  Version,
} from "./types";

/**
 * What the Studio page needs from the API, one method per route in docs/specs/studio.md (the SDK's
 * `studio*` methods). `ApiStudioClient` calls them through server actions; `FakeStudioClient` keeps
 * everything in memory so the page runs without a backend (development only).
 */
export interface StudioClient {
  readonly kind: "api" | "fake";
  apps(): Promise<StudioApp[]>;
  createApp(input: CreateAppInput): Promise<StudioApp>;
  app(id: string): Promise<AppDetail>;
  updateApp(id: string, patch: UpdateAppInput): Promise<StudioApp>;
  /** `PUT /apps/{id}/ship-mode`: the server checks the App policy's cap for the caller's role. */
  setShipMode(id: string, mode: ShipMode): Promise<StudioApp>;
  /** `POST /apps/{id}/retry`: sets a failed App up again; it is creating until setup succeeds or fails. */
  retryApp(id: string): Promise<StudioApp>;
  /** `DELETE /apps/{id}`: deletes a failed App with its chats and versions. */
  deleteApp(id: string): Promise<void>;
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
  /** The `ship` tool: push and open or update the App's pull request, or move it to Ready for review or Cancelled. */
  ship(appId: string, input: { title?: string; state?: "uat" | "ready_for_review" | "cancelled" }): Promise<AppPullRequest>;
  /** The merge gate's reviews of the team's App pull requests (`GET /merge-gate/reviews`). */
  mergeReviews(state?: MergeReview["state"]): Promise<MergeReview[]>;
  /** Stop: interrupts a chat's run. */
  interrupt(runId: string): Promise<void>;
  /** Calls `onChange` when the chat changes (the SSE route); returns a function that stops watching. */
  watchChat?(chatId: string, onChange: () => void): () => void;
  /** Push updates for everything (the fake). */
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
