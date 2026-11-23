import type { ContextDocWriter } from "./context-doc";
import type { ContextProvider } from "./context-sync";
import type {
  AppDetail,
  ApplyResult,
  AppPullRequest,
  ChatDetail,
  ChatMode,
  ContextSnapshot,
  ContextTurn,
  CreateAppInput,
  ForgeRepository,
  Member,
  MergeReview,
  NewChatInput,
  NewChatResult,
  Preview,
  Proposal,
  QuestionAnswer,
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
  /** `DELETE /chats/{id}`: deletes a chat that isn't working, with its worktree, preview and turns. */
  deleteChat(id: string): Promise<void>;
  send(chatId: string, input: { text: string; mode?: ChatMode; model?: string }): Promise<SendResult>;
  apply(chatId: string): Promise<ApplyResult>;
  chatDiff(chatId: string): Promise<{ diff: string }>;
  chatPreview(chatId: string): Promise<Preview>;
  /** Stops the chat's dev server and starts it again, with the App's current environment. */
  restartChatPreview(chatId: string): Promise<Preview>;
  restore(versionId: string): Promise<Version>;
  bookmark(versionId: string, on: boolean): Promise<Version>;
  versionDiff(versionId: string): Promise<{ diff: string }>;
  versionPreview(versionId: string): Promise<Preview>;
  restartVersionPreview(versionId: string): Promise<Preview>;
  status(): Promise<StatusReport>;
  /** Connected forge repositories, for "Import from GitHub". */
  repositories(): Promise<ForgeRepository[]>;
  /** The `ship` tool: push and open or update the App's pull request, or move it to Ready for review or Cancelled. */
  ship(appId: string, input: { title?: string; state?: "uat" | "ready_for_review" | "cancelled" }): Promise<AppPullRequest>;
  /** The merge gate's reviews of the team's App pull requests (`GET /merge-gate/reviews`). */
  mergeReviews(state?: MergeReview["state"]): Promise<MergeReview[]>;
  /** Allow or block a command a chat's run waits on: `POST /gates/{id}/decide` as the signed-in person. */
  decideApproval(gateId: string, decision: "approve" | "reject"): Promise<void>;
  /** Stop: interrupts a chat's run. */
  interrupt(runId: string): Promise<void>;
  /** Calls `onChange` when the chat changes (the SSE route); returns a function that stops watching. */
  watchChat?(chatId: string, onChange: () => void): () => void;
  /** Push updates for everything (the fake). */
  subscribe?(listener: () => void): () => void;
  /** The Context page's methods (docs/specs/studio-context.md). Absent until the server has them (Phase 2). */
  readonly context?: StudioContextClient;
}

/** The Brief: five lines written from the Context at one version. */
export type ContextBrief = { version: number; lines: string[] };

/**
 * What the Context page needs, one method per route in docs/specs/studio-context.md section 7. The
 * page sends no mode: the agent decides whether a request needs questions, Context changes, a
 * prototype change or only an answer. Every write is checked against the caller's permission; a
 * viewer's prompt or answer comes back as proposals.
 */
export interface StudioContextClient {
  /** The Yjs document and awareness of the App's Context. */
  provider(appId: string): ContextProvider;
  /** `GET /apps/{id}/context`: state, members, proposals, changes, the agent's status and the thread's turns. */
  snapshot(appId: string): Promise<ContextSnapshot>;
  /** Calls `onChange` when anything in the snapshot changes. */
  subscribe(appId: string, onChange: () => void): () => void;
  /** A request from the composer. While a turn runs it steers that turn. */
  prompt(appId: string, text: string): Promise<{ turn: ContextTurn; steered: boolean }>;
  /** `POST /questions/{id}/answer`. An editor's answer is recorded in the document; a viewer's is a proposal. */
  answer(appId: string, questionId: string, answer: QuestionAnswer): Promise<{ proposal?: Proposal }>;
  /** "Change answer": opens an answered question again. */
  reopen(appId: string, questionId: string): Promise<void>;
  /** `POST /questions/continue`: go on with what is answered; the agent assumes the rest. */
  continueQuestions(appId: string): Promise<void>;
  /** Build prototype / Update prototype: build from the Context as it is now. */
  build(appId: string): Promise<void>;
  /** Stop the running turn. */
  stop(appId: string): Promise<void>;
  /** A person's own proposal (a viewer's edit). */
  propose(appId: string, input: Pick<Proposal, "kind" | "summary" | "patch"> & { fragmentId?: string }): Promise<Proposal>;
  /** `POST /proposals/{id}/decide`. */
  decideProposal(appId: string, proposalId: string, decision: "accept" | "reject", reason?: string): Promise<Proposal>;
  /** Ask the agent to rewrite a piece of the Context. The new text streams through `onChunk`; nothing is written. */
  askAgent(appId: string, input: { text: string; instruction: string; fragmentId?: string }, onChunk: (chunk: string) => void): Promise<{ text: string }>;
  /** `GET /apps/{id}/brief`, cached per Context version. */
  brief(appId: string): Promise<ContextBrief>;
  /** Records that the caller has seen the Context at its current version. */
  markSeen(appId: string): Promise<void>;
  /** The prototype's preview. */
  preview(appId: string): Promise<Preview>;
  /** The fake's stand-in for the server's agent peer: how its scripted agent reads and writes the open document. */
  attachDocument?(appId: string, doc: ContextDocWriter): () => void;
  /** The fake only: the people one can be, to try the page as an editor, a viewer or a newcomer. */
  identities?(): Member[];
  setIdentity?(user: string): void;
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
