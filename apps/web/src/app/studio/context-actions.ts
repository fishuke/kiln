"use server";

import { KilnApiError } from "@kiln/sdk-ts";
import { z } from "zod";
import { api, errorMessage } from "@/lib/kiln";
import { AgentStatus, ContextChange, ContextState, ContextTurn, Member, Preview, Proposal, QuestionAnswer } from "@/lib/studio/types";
import type { StudioResult } from "./actions";

/** The Context's routes (ADR-019) as the signed-in user, each response parsed with its schema. */
async function call<S extends z.ZodType>(schema: S, method: "GET" | "POST", path: string, body?: unknown): Promise<StudioResult<z.infer<S>>> {
  try {
    const parsed = schema.safeParse(await api.request(method, path, body));
    if (!parsed.success) return { ok: false, error: `Unexpected Studio response: ${parsed.error.issues[0]?.message ?? "invalid"}` };
    return { ok: true, data: parsed.data };
  } catch (err) {
    return { ok: false, error: errorMessage(err), status: err instanceof KilnApiError ? err.status : undefined };
  }
}

const App = z.string().regex(/^sa_[A-Za-z0-9_-]+$/);
const Ref = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/);
const base = (appId: string) => `/api/v1/studio/apps/${App.parse(appId)}/context`;
const Ok = z.object({ ok: z.literal(true) });
const Snapshot = z.object({ state: ContextState, me: Member, members: z.array(Member), proposals: z.array(Proposal), changes: z.array(ContextChange), agent: AgentStatus, turns: z.array(ContextTurn) });
const Prompted = z.object({ turn: ContextTurn, steered: z.boolean() });
const Answered = z.object({ proposal: Proposal.optional() });
const Brief = z.object({ version: z.number(), lines: z.array(z.string()) });
const ProposeInput = z.object({ kind: z.enum(["edit", "add", "remove", "answer"]), summary: z.string().min(1).max(400), patch: z.unknown(), fragmentId: z.string().optional() });

export const contextSnapshot = async (appId: string) => call(Snapshot, "GET", base(appId));
export const contextPrompt = async (appId: string, text: string) => call(Prompted, "POST", `${base(appId)}/prompt`, { text: z.string().trim().min(1).parse(text) });
export const contextAnswer = async (appId: string, questionId: string, answer: unknown) =>
  call(Answered, "POST", `${base(appId)}/questions/${Ref.parse(questionId)}/answer`, { answer: QuestionAnswer.parse(answer) });
export const contextReopen = async (appId: string, questionId: string) => call(Ok, "POST", `${base(appId)}/questions/${Ref.parse(questionId)}/reopen`);
export const contextContinue = async (appId: string) => call(Ok, "POST", `${base(appId)}/questions/continue`);
export const contextBuild = async (appId: string) => call(Ok, "POST", `${base(appId)}/build`);
export const contextStop = async (appId: string) => call(Ok, "POST", `${base(appId)}/stop`);
export const contextPropose = async (appId: string, input: unknown) => call(Proposal, "POST", `${base(appId)}/proposals`, ProposeInput.parse(input));
export const contextDecide = async (appId: string, proposalId: string, decision: "accept" | "reject", reason?: string) =>
  call(Proposal, "POST", `${base(appId)}/proposals/${Ref.parse(proposalId)}/decide`, { decision: z.enum(["accept", "reject"]).parse(decision), ...(reason ? { reason: reason.slice(0, 400) } : {}) });
export const contextBrief = async (appId: string) => call(Brief, "GET", `${base(appId)}/brief`);
export const contextSeen = async (appId: string) => call(Ok, "POST", `${base(appId)}/seen`);
export const contextPreview = async (appId: string) => call(Preview, "GET", `${base(appId)}/preview`);
