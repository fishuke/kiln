"use client";

import { BlockNoteSchema, defaultBlockSpecs, defaultStyleSpecs } from "@blocknote/core";
import { createReactBlockSpec, createReactStyleSpec } from "@blocknote/react";
import { QUESTION_BLOCK, type TypedFragment } from "@/lib/studio/context-doc";
import { FragmentBlock } from "./blocks/fragment-block";
import { QuestionBlock } from "./blocks/question-block";

/**
 * What every typed fragment carries besides its text. Older documents may still carry `ownerRole`
 * and `reviewerRoles` on these blocks: undeclared attributes are ignored when the document loads.
 */
const fragmentProps = {
  /** Who wrote it last: a person's email, or "agent". */
  by: { default: "" },
  at: { default: "" },
  /** Where the prototype implements it (`previewReference`). */
  route: { default: "" },
  selector: { default: "" },
  /** The question this fragment was written from. */
  source: { default: "" },
} as const;

type FragmentRender = { block: { id: string; props: { route: string; by: string } }; editor: { updateBlock(id: string, update: { type: TypedFragment }): unknown }; contentRef: (el: HTMLElement | null) => void };

const renderFragment = (type: TypedFragment) =>
  function Fragment({ block, editor, contentRef }: FragmentRender) {
    return <FragmentBlock type={type} blockId={block.id} props={block.props} contentRef={contentRef} onType={(t) => editor.updateBlock(block.id, { type: t })} />;
  };

const fragment = <T extends TypedFragment>(type: T) =>
  createReactBlockSpec({ type, propSchema: fragmentProps, content: "inline" }, { render: renderFragment(type) as never });

const question = createReactBlockSpec(
  {
    type: QUESTION_BLOCK,
    propSchema: {
      questionId: { default: "" },
      /** The `QuestionSpec`, as JSON. */
      spec: { default: "" },
      status: { default: "open" },
      /** The `QuestionAnswer`, as JSON. */
      answer: { default: "" },
      by: { default: "" },
      at: { default: "" },
      batch: { default: "" },
      index: { default: 0 },
      total: { default: 1 },
      turn: { default: "" },
    },
    content: "none",
  },
  { render: ({ block }) => <QuestionBlock blockId={block.id} props={block.props} /> },
);

/** Inline suggestion marks: what "Ask the agent" would add and what it would remove. The value is the suggestion's id. */
const suggestAdd = createReactStyleSpec({ type: "suggestAdd", propSchema: "string" }, { render: ({ contentRef }) => <ins className="ctx-suggest-add" ref={contentRef} /> });
const suggestDel = createReactStyleSpec({ type: "suggestDel", propSchema: "string" }, { render: ({ contentRef }) => <del className="ctx-suggest-del" ref={contentRef} /> });

/**
 * The Context document's schema: BlockNote's own blocks (plain text stays plain) plus one block per
 * typed fragment and the question block. No table, media or file blocks: the Context is writing.
 */
export const contextSchema = BlockNoteSchema.create({
  blockSpecs: {
    paragraph: defaultBlockSpecs.paragraph,
    heading: defaultBlockSpecs.heading,
    bulletListItem: defaultBlockSpecs.bulletListItem,
    numberedListItem: defaultBlockSpecs.numberedListItem,
    checkListItem: defaultBlockSpecs.checkListItem,
    quote: defaultBlockSpecs.quote,
    image: defaultBlockSpecs.image,
    requirement: fragment("requirement")(),
    decision: fragment("decision")(),
    assumption: fragment("assumption")(),
    constraint: fragment("constraint")(),
    flow: fragment("flow")(),
    risk: fragment("risk")(),
    metric: fragment("metric")(),
    question: question(),
  },
  styleSpecs: { ...defaultStyleSpecs, suggestAdd, suggestDel },
});

export type ContextEditor = typeof contextSchema.BlockNoteEditor;
export type ContextBlock = typeof contextSchema.Block;
