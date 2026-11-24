import * as actions from "@/app/studio/context-actions";
import type { StudioResult } from "@/app/studio/actions";
import { StudioClientError, type StudioContextClient } from "./client";
import { serverProvider, type ServerSync } from "./context-server-sync";

async function unwrap<T>(p: Promise<StudioResult<T>>): Promise<T> {
  const r = await p;
  if (!r.ok) throw new StudioClientError(r.error, r.status);
  return r.data;
}

/** How often the page asks for the snapshot again besides the server's own "changed": a turn's steps aren't pushed. */
const REFRESH_MS = 4000;

/** The Context page's client on the API. "Ask the agent" on a selection has no server side yet, so it is absent here. */
export class ApiContext implements StudioContextClient {
  private providers = new Map<string, ServerSync>();

  provider(appId: string): ServerSync {
    let p = this.providers.get(appId);
    if (!p) this.providers.set(appId, (p = serverProvider(appId)));
    return p;
  }

  subscribe(appId: string, onChange: () => void): () => void {
    const off = this.provider(appId).onChanged(onChange);
    const timer = setInterval(() => document.visibilityState === "visible" && onChange(), REFRESH_MS);
    return () => {
      off();
      clearInterval(timer);
    };
  }

  snapshot = (appId: string) => unwrap(actions.contextSnapshot(appId));
  prompt = (appId: string, text: string) => unwrap(actions.contextPrompt(appId, text));
  answer: StudioContextClient["answer"] = (appId, questionId, answer) => unwrap(actions.contextAnswer(appId, questionId, answer));
  reopen = async (appId: string, questionId: string) => void (await unwrap(actions.contextReopen(appId, questionId)));
  continueQuestions = async (appId: string) => void (await unwrap(actions.contextContinue(appId)));
  build = async (appId: string) => void (await unwrap(actions.contextBuild(appId)));
  stop = async (appId: string) => void (await unwrap(actions.contextStop(appId)));
  propose: StudioContextClient["propose"] = (appId, input) => unwrap(actions.contextPropose(appId, input));
  decideProposal: StudioContextClient["decideProposal"] = (appId, proposalId, decision, reason) => unwrap(actions.contextDecide(appId, proposalId, decision, reason));
  brief = (appId: string) => unwrap(actions.contextBrief(appId));
  markSeen = async (appId: string) => void (await unwrap(actions.contextSeen(appId)));
  preview = (appId: string) => unwrap(actions.contextPreview(appId));
  setMember: StudioContextClient["setMember"] = (appId, input) => unwrap(actions.contextSetMember(appId, input));
  removeMember = async (appId: string, user: string) => void (await unwrap(actions.contextRemoveMember(appId, user)));
  setRole: StudioContextClient["setRole"] = (appId, role) => unwrap(actions.contextSetRole(appId, role));
  comment: StudioContextClient["comment"] = (appId, input) => unwrap(actions.contextComment(appId, input));
  resolveThread: StudioContextClient["resolveThread"] = (appId, threadId, resolved) => unwrap(actions.contextResolveThread(appId, threadId, resolved));
  signOff: StudioContextClient["signOff"] = (appId, fragmentId, state) => unwrap(actions.contextSignOff(appId, fragmentId, state));
  requestReview = async (appId: string, fragmentId: string, role: Parameters<StudioContextClient["requestReview"]>[2]) => void (await unwrap(actions.contextRequestReview(appId, fragmentId, role)));
}
