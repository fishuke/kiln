"use client";

import { createContext, useContext } from "react";
import type { Member, Proposal, Question, QuestionAnswer } from "@/lib/studio/types";

/** What the document's blocks need from the page around them. */
export type ContextUI = {
  appId: string;
  me: Member;
  canEdit: boolean;
  /** Every question in the document, for steppers and batch progress. */
  questions: Question[];
  proposals: Proposal[];
  /** Per fragment id: how many times its content settled. */
  versions: Record<string, number>;
  /** True once the document has loaded: blocks that mount after it animate in. */
  live: boolean;
  nameOf(user: string): string;
  answer(q: Question, answer: QuestionAnswer): Promise<boolean>;
  reopen(q: Question): Promise<void>;
  /** Opens "Ask the agent" on a whole fragment. */
  askAbout(blockId: string): void;
  showInPrototype(route: string): void;
};

const Ctx = createContext<ContextUI | undefined>(undefined);
export const ContextUIProvider = Ctx.Provider;

export function useContextUI(): ContextUI {
  const v = useContext(Ctx);
  if (!v) throw new Error("Context blocks render inside the Context document");
  return v;
}
