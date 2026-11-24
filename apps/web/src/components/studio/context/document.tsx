"use client";

import { filterSuggestionItems, insertOrUpdateBlockForSlashMenu } from "@blocknote/core";
import { withCollaboration } from "@blocknote/core/yjs";
import {
  BasicTextStyleButton,
  BlockTypeSelect,
  CreateLinkButton,
  FormattingToolbar,
  FormattingToolbarController,
  getDefaultReactSlashMenuItems,
  SuggestionMenuController,
  useComponentsContext,
  useCreateBlockNote,
  type DefaultReactSuggestionItem,
} from "@blocknote/react";
import { BlockNoteView } from "@blocknote/shadcn";
import "@blocknote/shadcn/style.css";
import { Check, LoaderCircle, Sparkles, X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { StudioContextClient } from "@/lib/studio/client";
import { questionProps, TYPED_FRAGMENTS, type DocBlock } from "@/lib/studio/context-doc";
import { canEdit as mayEdit, delegatedAnswer, fragmentTitle, questionsFrom, statusFor } from "@/lib/studio/context-model";
import type { AgentStatus, Member, Proposal } from "@/lib/studio/types";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { AskAgent, type AskTarget } from "./ask-agent";
import { ContextUIProvider, useContextUI, type ContextUI } from "./context-ui";
import { contentRange, editorWriter, readBlocks } from "./doc-writer";
import { FRAGMENT_META, FragmentGlyph } from "./fragment-meta";
import { memberColor } from "./people";
import { contextSchema, type ContextBlock, type ContextEditor } from "./schema";
import { appendSuggestion, resolveSuggestion, startSuggestion, suggestionIds, suggestionRange } from "./suggestions";

export type DocumentHandle = {
  /** Scrolls a fragment into view and marks it for a moment. */
  scrollTo(id: string): void;
  /** Scrolls to where the agent is writing and follows it again. */
  jumpToAgent(): void;
};

type Spot = { top: number; left: number; height: number };

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Whether the page is in the dark theme (the `dark` class on the root element). */
function useDark(): boolean {
  const [dark, setDark] = useState(() => typeof document !== "undefined" && document.documentElement.classList.contains("dark"));
  useEffect(() => {
    const root = document.documentElement;
    const o = new MutationObserver(() => setDark(root.classList.contains("dark")));
    o.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => o.disconnect();
  }, []);
  return dark;
}

/** "Ask the agent" in the toolbar that shows on a text selection. The toolbar is short on purpose: the Context is writing, and it must fit a narrow pane. */
function AskButton() {
  const Components = useComponentsContext()!;
  const ui = useContextUI();
  if (!ui.canAsk) return null;
  return (
    <Components.FormattingToolbar.Button className="bn-button" label="Ask the agent" mainTooltip="Ask the agent to change this" icon={<Sparkles className="size-4" />} onClick={ui.askSelection}>
      Ask
    </Components.FormattingToolbar.Button>
  );
}

function SelectionToolbar() {
  return (
    <FormattingToolbar>
      <AskButton key="askAgent" />
      <BlockTypeSelect key="blockTypeSelect" />
      <BasicTextStyleButton basicTextStyle="bold" key="boldStyleButton" />
      <BasicTextStyleButton basicTextStyle="italic" key="italicStyleButton" />
      <BasicTextStyleButton basicTextStyle="underline" key="underlineStyleButton" />
      <BasicTextStyleButton basicTextStyle="strike" key="strikeStyleButton" />
      <CreateLinkButton key="createLinkButton" />
    </FormattingToolbar>
  );
}

/**
 * The Context document: BlockNote on the App's shared Yjs document, with the typed fragments and
 * question blocks, the agent's cursor, and "Ask the agent" on a selection with Accept and Reject.
 * It owns the pane's one scrolling surface; `header` (the Brief) scrolls with the text.
 */
export function ContextDocument({
  ctx,
  appId,
  me,
  proposals,
  versions,
  agent,
  nameOf,
  onBlocks,
  onAway,
  onShowInPrototype,
  threadCounts,
  onOpenThreads,
  onActed,
  handle,
  header,
  empty,
}: {
  ctx: StudioContextClient;
  appId: string;
  me: Member;
  proposals: Proposal[];
  versions: Record<string, number>;
  agent: AgentStatus;
  nameOf(user: string): string;
  /** Every block of the document, after each change by anyone. */
  onBlocks(blocks: DocBlock[]): void;
  /** True while the agent writes somewhere the person scrolled away from. */
  onAway(away: boolean): void;
  onShowInPrototype(route: string, fragmentId?: string): void;
  /** Per fragment id: its open comment threads. */
  threadCounts: Record<string, number>;
  onOpenThreads(fragmentId: string): void;
  /** The person did something the agent will pick up (an answer): the page shows it at once. */
  onActed(): void;
  handle: React.Ref<DocumentHandle>;
  header?: React.ReactNode;
  /** The first-run state, shown in place of the document while it is empty. */
  empty?: React.ReactNode;
}) {
  const canEdit = mayEdit(me.permission);
  const dark = useDark();
  const reduced = useReducedMotion();
  const provider = useMemo(() => ctx.provider(appId), [ctx, appId]);
  const editor: ContextEditor = useCreateBlockNote(
    withCollaboration({
      schema: contextSchema,
      placeholders: { default: "Write, or type / for a fragment", heading: "Section" },
      collaboration: {
        fragment: provider.doc.getXmlFragment("context"),
        user: { name: me.name, color: memberColor(me.user) },
        provider: { awareness: provider.awareness },
        showCursorLabels: "activity" as const,
      },
    }),
    [provider, me.user],
  );

  const scroller = useRef<HTMLDivElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [blocks, setBlocks] = useState<DocBlock[]>([]);
  const [tick, setTick] = useState(0);
  const [live, setLive] = useState(false);

  // The fake's scripted agent writes through this editor (the server's agent is its own peer).
  useEffect(() => ctx.attachDocument?.(appId, editorWriter(editor)), [ctx, appId, editor]);

  useEffect(() => {
    const read = () => {
      setBlocks(readBlocks(editor.document as ContextBlock[]));
      setTick((t) => t + 1);
    };
    read();
    // A peer's change reaches the editor through the shared document; read after those too.
    const remote = (_u: Uint8Array, origin: unknown) => origin !== null && queueMicrotask(read);
    provider.doc.on("update", remote);
    const off = editor.onChange(read);
    return () => {
      off();
      provider.doc.off("update", remote);
    };
  }, [editor, provider]);
  useEffect(() => onBlocks(blocks), [blocks, onBlocks]);

  // Blocks already in the document when it loads don't animate in; what arrives after does.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    void provider.synced.then(() => (timer = setTimeout(() => setLive(true), 600)));
    return () => clearTimeout(timer);
  }, [provider]);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const o = new ResizeObserver(() => setTick((t) => t + 1));
    o.observe(el);
    return () => o.disconnect();
  }, []);

  /** A document position as a spot inside the scrolling content. */
  const spot = useCallback(
    (pos: number): Spot | undefined => {
      const box = wrap.current?.getBoundingClientRect();
      if (!box) return undefined;
      try {
        const c = editor.prosemirrorView.coordsAtPos(pos);
        return { top: c.top - box.top, left: c.left - box.left, height: c.bottom - c.top };
      } catch {
        return undefined;
      }
    },
    [editor],
  );

  const behavior: ScrollBehavior = reduced ? "auto" : "smooth";

  // --- the agent's cursor ----------------------------------------------------------------------

  const [cursor, setCursor] = useState<Spot>();
  const following = useRef(true);
  const writingIn = agent.state === "writing" ? agent.fragmentId : undefined;
  useEffect(() => {
    following.current = true;
  }, [agent.turnId]);

  const checkAway = useCallback(
    (c: Spot | undefined) => {
      const view = scroller.current;
      if (!c || !view || !wrap.current) return onAway(false);
      const top = c.top + wrap.current.offsetTop;
      const visible = top >= view.scrollTop + 8 && top + c.height <= view.scrollTop + view.clientHeight - 8;
      if (visible) following.current = true;
      else if (following.current) view.scrollTo({ top: Math.max(0, top - view.clientHeight * 0.6), behavior });
      onAway(!visible && !following.current);
    },
    [onAway, behavior],
  );

  useLayoutEffect(() => {
    const range = writingIn ? contentRange(editor, writingIn) : undefined;
    const next = range ? spot(range.to) : undefined;
    setCursor((was) => (was && next && was.top === next.top && was.left === next.left ? was : next));
    checkAway(next);
  }, [editor, writingIn, tick, spot, checkAway]);

  useEffect(() => {
    const view = scroller.current;
    if (!view) return;
    // Scrolling by hand stops the page from following the agent; the dock then offers to jump back.
    const let_go = () => {
      following.current = false;
    };
    const onScroll = () => checkAway(cursor);
    view.addEventListener("wheel", let_go, { passive: true });
    view.addEventListener("touchmove", let_go, { passive: true });
    view.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      view.removeEventListener("wheel", let_go);
      view.removeEventListener("touchmove", let_go);
      view.removeEventListener("scroll", onScroll);
    };
  }, [cursor, checkAway]);

  useImperativeHandle(
    handle,
    () => ({
      scrollTo(id: string) {
        const el = wrap.current?.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"]`);
        if (!el) return;
        following.current = false;
        el.scrollIntoView({ block: "center", behavior });
        el.classList.add("ctx-flash");
        setTimeout(() => el.classList.remove("ctx-flash"), 1400);
      },
      jumpToAgent() {
        following.current = true;
        checkAway(cursor);
      },
    }),
    [behavior, cursor, checkAway],
  );

  // --- Ask the agent ---------------------------------------------------------------------------

  const [ask, setAsk] = useState<AskTarget>();
  const [rewriting, setRewriting] = useState<string[]>([]);

  const openAsk = useCallback(
    (blockId: string, range: { from: number; to: number }) => {
      const text = editor.prosemirrorState.doc.textBetween(range.from, range.to).trim();
      if (!text) return void toast("Select some text to ask about");
      setAsk({ blockId, range, text });
    },
    [editor],
  );

  const askAbout = useCallback(
    (blockId: string) => {
      const range = contentRange(editor, blockId);
      if (range) openAsk(blockId, range);
    },
    [editor, openAsk],
  );

  const askSelection = useCallback(() => {
    const { from, to, empty: none, $from } = editor.prosemirrorState.selection;
    if (none) return;
    let blockId = "";
    for (let d = $from.depth; d > 0 && !blockId; d -= 1) blockId = String($from.node(d).attrs.id ?? "");
    // A suggestion stays inside one block: a selection across blocks asks about the first.
    if (blockId) openAsk(blockId, { from, to: Math.min(to, $from.end()) });
  }, [editor, openAsk]);

  /** An editor's request: the agent's text streams into the document as a suggestion to accept or reject. */
  const suggest = useCallback(
    async (target: AskTarget, instruction: string) => {
      const id = `sg_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      setAsk(undefined);
      setRewriting((r) => [...r, id]);
      startSuggestion(editor, id, target.range);
      try {
        await ctx.askAgent!(appId, { text: target.text, instruction, fragmentId: target.blockId }, (chunk) => appendSuggestion(editor, id, chunk));
      } catch (err) {
        resolveSuggestion(editor, id, false);
        toast.error(message(err));
      } finally {
        setRewriting((r) => r.filter((x) => x !== id));
      }
    },
    [ctx, appId, editor],
  );

  /** A viewer's request: nothing is written; the agent's text comes back to send as a proposal. */
  const draft = useCallback((target: AskTarget, instruction: string, onChunk: (chunk: string) => void) => ctx.askAgent!(appId, { text: target.text, instruction, fragmentId: target.blockId }, onChunk).then((r) => r.text), [ctx, appId]);

  const propose = useCallback(
    async (target: AskTarget, to: string) => {
      try {
        await ctx.propose(appId, { kind: "edit", fragmentId: target.blockId, summary: `Change "${fragmentTitle(target.text, 48)}" to "${fragmentTitle(to, 48)}"`, patch: { from: target.text, to } });
        toast.success("Sent to an editor as a proposal");
        setAsk(undefined);
      } catch (err) {
        toast.error(message(err));
      }
    },
    [ctx, appId],
  );

  const [suggestions, setSuggestions] = useState<{ id: string; at: Spot }[]>([]);
  const [askAt, setAskAt] = useState<Spot>();
  useLayoutEffect(() => {
    const next = suggestionIds(editor).flatMap((id) => {
      const range = suggestionRange(editor, id);
      const at = range ? spot(range.to) : undefined;
      return at ? [{ id, at }] : [];
    });
    setSuggestions((was) => (JSON.stringify(was) === JSON.stringify(next) ? was : next));
    setAskAt(ask ? spot(ask.range.to) : undefined);
  }, [editor, tick, ask, spot]);

  // --- what the blocks need --------------------------------------------------------------------

  const questions = useMemo(() => questionsFrom(appId, blocks), [appId, blocks]);
  const ui: ContextUI = useMemo(
    () => ({
      appId,
      me,
      canEdit,
      questions,
      proposals,
      versions,
      live,
      nameOf,
      async answer(q, answer) {
        // An editor's answer shows at once: the block settles here and now, and the server hears of it
        // in the background. If the server refuses, the question opens again and says why.
        const block = canEdit ? editor.getBlock(q.fragmentId) : undefined;
        if (block) {
          const recorded = answer.type === "delegated" ? delegatedAnswer(q.spec) : answer;
          editor.updateBlock(q.fragmentId, { props: questionProps({ ...q, status: statusFor(answer), answer: recorded, answeredBy: me.user, answeredAt: new Date().toISOString() }) } as never);
          onActed();
          void ctx.answer(appId, q.id, answer).catch((err: unknown) => {
            if (editor.getBlock(q.fragmentId)) editor.updateBlock(q.fragmentId, { props: questionProps(q) } as never);
            toast.error(message(err));
          });
          return true;
        }
        try {
          const r = await ctx.answer(appId, q.id, answer);
          if (r.proposal) toast.success("Sent to an editor as a proposal");
          return true;
        } catch (err) {
          toast.error(message(err));
          return false;
        }
      },
      async reopen(q) {
        const was = editor.getBlock(q.fragmentId)?.props;
        if (canEdit && was) editor.updateBlock(q.fragmentId, { props: { status: "open", by: "", at: "" } } as never);
        await ctx.reopen(appId, q.id).catch((err: unknown) => {
          if (canEdit && was && editor.getBlock(q.fragmentId)) editor.updateBlock(q.fragmentId, { props: was } as never);
          toast.error(message(err));
        });
      },
      canAsk: Boolean(ctx.askAgent),
      threadCounts,
      openThreads: onOpenThreads,
      askAbout,
      askSelection,
      showInPrototype: onShowInPrototype,
    }),
    [appId, me, canEdit, questions, proposals, versions, live, nameOf, ctx, editor, askAbout, askSelection, onShowInPrototype, threadCounts, onOpenThreads, onActed],
  );

  const slashItems = useCallback(
    async (query: string) => {
      const fragments: DefaultReactSuggestionItem[] = TYPED_FRAGMENTS.map((type) => ({
        title: FRAGMENT_META[type].label,
        subtext: FRAGMENT_META[type].hint,
        aliases: [type],
        group: "Fragments",
        icon: <FragmentGlyph type={type} className="size-[18px]" />,
        onItemClick: () => void insertOrUpdateBlockForSlashMenu(editor, { type, props: { by: me.user, at: new Date().toISOString(), ownerRole: me.role } }),
      }));
      return filterSuggestionItems([...fragments, ...getDefaultReactSlashMenuItems(editor)], query);
    },
    [editor, me.user, me.role],
  );

  const edge = (left: number, width: number) => Math.max(0, Math.min(left, (wrap.current?.clientWidth ?? width) - width));

  return (
    <div ref={scroller} className="ctx-scroll @container min-h-0 flex-1 overflow-y-auto overscroll-contain" data-context-scroller>
      <div ref={wrap} className={cn("relative mx-auto w-full max-w-[816px] pt-6 pr-3 pb-24 pl-10 @lg:pr-8 @lg:pl-16", empty && "flex min-h-full flex-col justify-center px-4 pb-6 @lg:px-8")}>
        {empty}
        {!empty && header}
        <div className={cn("ctx-doc", empty && "invisible h-0 overflow-hidden")} aria-hidden={empty ? true : undefined}>
          <ContextUIProvider value={ui}>
            <BlockNoteView
              editor={editor}
              editable={canEdit}
              theme={dark ? "dark" : "light"}
              slashMenu={false}
              formattingToolbar={false}
              filePanel={false}
              tableHandles={false}
              emojiPicker={false}
              comments={false}
              aria-label="Context"
            >
              <SuggestionMenuController triggerCharacter="/" getItems={slashItems} />
              <FormattingToolbarController formattingToolbar={SelectionToolbar} />
            </BlockNoteView>
          </ContextUIProvider>
        </div>

        <AnimatePresence>
          {cursor && !empty && (
            <motion.div
              key="agent-cursor"
              aria-hidden
              className="ctx-agent-cursor"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15, ease: "easeOut" }}
              // The position is set, not animated: the cursor stays on the last character as text streams in.
              style={{ height: cursor.height, x: cursor.left, y: cursor.top }}
            >
              <span className="ctx-agent-cursor-label">
                <Sparkles className="size-2.5" />
                Agent
              </span>
            </motion.div>
          )}
        </AnimatePresence>

        {suggestions.map(({ id, at }) => (
          <div key={id} className="absolute z-10" style={{ top: at.top + at.height + 4, left: edge(at.left - 40, 200) }} data-suggestion={id}>
            {rewriting.includes(id) ? (
              <span className="flex h-7 items-center gap-1.5 rounded-full border bg-background px-2.5 text-xs text-muted-foreground shadow-sm">
                <LoaderCircle className="size-3 animate-spin" />
                Rewriting
              </span>
            ) : canEdit ? (
              <motion.div initial={{ opacity: 0, y: -2 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.15 }} role="group" aria-label="Suggestion" className="flex items-center gap-0.5 rounded-full border bg-background p-0.5 shadow-sm">
                <Button size="xs" className="rounded-full" onClick={() => resolveSuggestion(editor, id, true)}>
                  <Check data-icon="inline-start" />
                  Accept
                </Button>
                <Button size="xs" variant="ghost" className="rounded-full" onClick={() => resolveSuggestion(editor, id, false)}>
                  <X data-icon="inline-start" />
                  Reject
                </Button>
              </motion.div>
            ) : (
              <span className="flex h-7 items-center rounded-full border bg-background px-2.5 text-xs text-muted-foreground shadow-sm">A suggestion an editor decides</span>
            )}
          </div>
        ))}

        <AnimatePresence>
          {ask && askAt && (
            <AskAgent
              key={`${ask.blockId}:${ask.range.from}`}
              target={ask}
              canEdit={canEdit}
              style={{ top: askAt.top + askAt.height + 8, left: edge(askAt.left - 24, 360) }}
              onSuggest={(instruction) => void suggest(ask, instruction)}
              onDraft={(instruction, onChunk) => draft(ask, instruction, onChunk)}
              onPropose={(to) => propose(ask, to)}
              onClose={() => setAsk(undefined)}
            />
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
