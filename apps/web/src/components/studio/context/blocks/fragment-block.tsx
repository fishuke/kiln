"use client";

import { Check, Crosshair, MessageSquare, Sparkles } from "lucide-react";
import { motion } from "motion/react";
import { useState } from "react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { TYPED_FRAGMENTS, type TypedFragment } from "@/lib/studio/context-doc";
import { VIEWER_NOTE } from "@/lib/studio/context-model";
import { FunctionalRole } from "@/lib/studio/types";
import { cn } from "@/lib/utils";
import { useContextUI } from "../context-ui";
import { FRAGMENT_META, FragmentGlyph, ROLE_LABEL } from "../fragment-meta";

/** A small icon button in a block's gutter, with its tooltip. */
export function GutterButton({ label, onClick, disabled, children }: { label: string; onClick?: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={label}
            aria-disabled={disabled}
            onClick={disabled ? undefined : onClick}
            className={cn(
              "flex size-6 items-center justify-center rounded-md text-muted-foreground transition-[background-color,color,transform] duration-150 hover:bg-muted hover:text-foreground active:scale-95",
              disabled && "cursor-not-allowed opacity-50 hover:bg-transparent hover:text-muted-foreground active:scale-100",
            )}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * A typed fragment: its mark on the left (the type's glyph, which is also the type menu), the text,
 * and a gutter on the right that shows on hover or focus: owner, version, Ask the agent, and the
 * link to where the prototype implements it.
 */
export function FragmentBlock({
  type,
  blockId,
  props,
  contentRef,
  onType,
}: {
  type: TypedFragment;
  blockId: string;
  props: { ownerRole: string; route: string; by: string };
  contentRef: (el: HTMLElement | null) => void;
  onType: (type: TypedFragment) => void;
}) {
  const ui = useContextUI();
  const meta = FRAGMENT_META[type];
  const owner = FunctionalRole.safeParse(props.ownerRole);
  const version = ui.versions[blockId];
  // A fragment that arrives while the page is open carries a tint that fades.
  const [arrived] = useState(ui.live);
  return (
    <motion.div
      className={cn("ctx-fragment group/fragment", meta.tone)}
      data-fragment={type}
      data-arrived={arrived || undefined}
      initial={ui.live ? { opacity: 0, y: 6 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15, ease: "easeOut" }}
    >
      <div contentEditable={false} className="ctx-fragment-mark">
        {ui.canEdit ? (
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger
                render={
                  <DropdownMenuTrigger
                    render={<button type="button" aria-label={`${meta.label}. Change type`} className="flex size-6 items-center justify-center rounded-md transition-[background-color,transform] duration-150 hover:bg-muted active:scale-95" />}
                  />
                }
              >
                <FragmentGlyph type={type} />
              </TooltipTrigger>
              <TooltipContent>{meta.label}</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="start" className="w-64">
              <DropdownMenuGroup>
                <DropdownMenuLabel>Fragment type</DropdownMenuLabel>
                {TYPED_FRAGMENTS.map((t) => (
                  <DropdownMenuItem key={t} onClick={() => onType(t)} className="items-start gap-2.5">
                    <FragmentGlyph type={t} className="mt-0.5 size-4" />
                    <span className="flex flex-col">
                      <span className="font-medium">{FRAGMENT_META[t].label}</span>
                      <span className="text-xs text-muted-foreground">{FRAGMENT_META[t].hint}</span>
                    </span>
                    {t === type && <Check className="ml-auto size-4" />}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <Tooltip>
            <TooltipTrigger render={<span className="flex size-6 items-center justify-center" />}>
              <FragmentGlyph type={type} />
            </TooltipTrigger>
            <TooltipContent>
              {meta.label}. {VIEWER_NOTE}
            </TooltipContent>
          </Tooltip>
        )}
      </div>
      <p ref={contentRef} className="ctx-fragment-text" />
      <div contentEditable={false} className="ctx-fragment-gutter">
        <span className="px-1 text-[11px] whitespace-nowrap text-muted-foreground">
          {owner.success ? ROLE_LABEL[owner.data] : "Product"}
          {version && version > 1 ? ` · v${version}` : ""}
        </span>
        {props.route && (
          <GutterButton label={`Show in the prototype (${props.route})`} onClick={() => ui.showInPrototype(props.route, blockId)}>
            <Crosshair className="size-3.5" />
          </GutterButton>
        )}
        <GutterButton label={ui.threadCounts[blockId] ? `${ui.threadCounts[blockId]} open ${ui.threadCounts[blockId] === 1 ? "thread" : "threads"}` : "Comment"} onClick={() => ui.openThreads(blockId)}>
          <span className="relative flex">
            <MessageSquare className="size-3.5" />
            {ui.threadCounts[blockId] ? <span className="absolute -top-1 -right-1.5 size-2 rounded-full bg-amber-500 ring-2 ring-background" /> : null}
          </span>
        </GutterButton>
        {ui.canAsk && (
          <GutterButton label={ui.canEdit ? "Ask the agent to change this" : "Ask the agent. Your change becomes a proposal"} onClick={() => ui.askAbout(blockId)}>
            <Sparkles className="size-3.5" />
          </GutterButton>
        )}
      </div>
    </motion.div>
  );
}
