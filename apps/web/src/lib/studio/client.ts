import type {
  ApplyResult,
  ChatDetail,
  CreateProjectInput,
  ForgeRepository,
  NewChatInput,
  Preview,
  Project,
  ProjectDetail,
  SendResult,
  StatusReport,
  UpdateProjectInput,
  Version,
  NewChatResult,
  ChatMode,
} from "./types";

/**
 * What the Studio page needs from the API, one method per route in docs/specs/studio.md (named like
 * the SDK's `studio*` methods). `ApiStudioClient` calls the routes through server actions;
 * `FakeStudioClient` keeps everything in memory so the page runs without a backend.
 */
export interface StudioClient {
  readonly kind: "api" | "fake";
  projects(): Promise<{ projects: Project[] }>;
  createProject(input: CreateProjectInput): Promise<Project>;
  project(id: string): Promise<ProjectDetail>;
  updateProject(id: string, patch: UpdateProjectInput): Promise<Project>;
  newChat(projectId: string, input: NewChatInput): Promise<NewChatResult>;
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
  /** Push updates (the fake); the API client polls instead and returns undefined. */
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
