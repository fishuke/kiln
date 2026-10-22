"use client";

import { Check, ChevronDown, Hammer, ListChecks, MessageCircle, Mic, MicOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { PromptInput } from "@/components/kiln/prompt-input";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { InputGroupButton } from "@/components/ui/input-group";
import { Kbd } from "@/components/ui/kbd";
import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { MODES, usd, type chatUsage } from "@/lib/studio/model";
import type { ChatMode } from "@/lib/studio/types";
import { cn } from "@/lib/utils";

export const MODE_ICON: Record<ChatMode, React.ComponentType<{ className?: string }>> = { build: Hammer, chat: MessageCircle, plan: ListChecks };

/** Mode menu: Build, Chat or Plan, with what each may do. ⌥P cycles them anywhere on the page. */
function ModeMenu({ mode, onChange }: { mode: ChatMode; onChange: (m: ChatMode) => void }) {
  const Icon = MODE_ICON[mode];
  const current = MODES.find((m) => m.id === mode)!;
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger
          render={<DropdownMenuTrigger render={<InputGroupButton size="xs" variant="ghost" aria-label={`Mode: ${current.label}`} className="gap-1 px-2" />} />}
        >
          <Icon className="size-3.5" />
          {current.label}
          <ChevronDown className="size-3 opacity-60" />
        </TooltipTrigger>
        <TooltipContent>
          Switch mode <Kbd>⌥P</Kbd>
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Mode</DropdownMenuLabel>
          {MODES.map((m) => {
            const I = MODE_ICON[m.id];
            return (
              <DropdownMenuItem key={m.id} onClick={() => onChange(m.id)} className="items-start gap-2.5 py-2">
                <I className="mt-0.5 size-4" />
                <span className="flex flex-col">
                  <span className="font-medium">{m.label}</span>
                  <span className="text-xs text-muted-foreground">{m.hint}</span>
                </span>
                {m.id === mode && <Check className="ml-auto size-4" />}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export const MODELS: { provider: string; models: { id: string; name: string }[] }[] = [
  {
    provider: "Anthropic",
    models: [
      { id: "claude-opus-5-5", name: "Claude Opus 5.5" },
      { id: "claude-sonnet-5", name: "Claude Sonnet 5" },
      { id: "claude-haiku-5-5", name: "Claude Haiku 5.5" },
    ],
  },
  {
    provider: "OpenAI",
    models: [
      { id: "gpt-5", name: "GPT-5" },
      { id: "gpt-5-mini", name: "GPT-5 mini" },
    ],
  },
];

export function modelName(id: string | undefined): string {
  if (!id) return "Default model";
  return MODELS.flatMap((p) => p.models).find((m) => m.id === id)?.name ?? id;
}

/** Model Selector. A chat keeps its model, so it's locked once the chat has turns. */
function ModelSelector({ model, onChange, locked }: { model?: string; onChange: (m: string | undefined) => void; locked: boolean }) {
  const trigger = (
    <InputGroupButton size="xs" variant="ghost" disabled={locked} aria-label={`Model: ${modelName(model)}`} className="gap-1 px-2 text-muted-foreground">
      {modelName(model)}
      {!locked && <ChevronDown className="size-3 opacity-60" />}
    </InputGroupButton>
  );
  if (locked)
    return (
      <Tooltip>
        <TooltipTrigger render={<span tabIndex={0} />}>{trigger}</TooltipTrigger>
        <TooltipContent>A chat keeps its model. Start a new chat to use another.</TooltipContent>
      </Tooltip>
    );
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={trigger} />
      <DropdownMenuContent align="start" className="w-52">
        <DropdownMenuRadioGroup value={model ?? ""} onValueChange={(v: string) => onChange(v || undefined)}>
          <DropdownMenuRadioItem value="" closeOnClick>
            Default model
          </DropdownMenuRadioItem>
          {MODELS.map((p) => (
            <DropdownMenuGroup key={p.provider}>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>{p.provider}</DropdownMenuLabel>
              {p.models.map((m) => (
                <DropdownMenuRadioItem key={m.id} value={m.id} closeOnClick>
                  {m.name}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuGroup>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
};

/** Dictation: the Web Speech API turns speech into text in the box. Hidden where it isn't supported. */
function DictationButton({ onText }: { onText: (text: string) => void }) {
  const [supported, setSupported] = useState(false);
  const [on, setOn] = useState(false);
  const rec = useRef<Recognition | null>(null);
  useEffect(() => {
    const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
    setSupported(Boolean(w.SpeechRecognition ?? w.webkitSpeechRecognition));
  }, []);
  if (!supported) return null;
  const toggle = () => {
    if (on) {
      rec.current?.stop();
      return;
    }
    const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
    const R = (w.SpeechRecognition ?? w.webkitSpeechRecognition)!;
    const r = new R();
    r.lang = navigator.language;
    r.interimResults = false;
    r.continuous = true;
    r.onresult = (e) => {
      const last = e.results[e.results.length - 1];
      if (last?.isFinal) onText(last[0]!.transcript.trim());
    };
    r.onend = () => setOn(false);
    rec.current = r;
    r.start();
    setOn(true);
  };
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <InputGroupButton
            size="icon-xs"
            variant={on ? "secondary" : "ghost"}
            aria-pressed={on}
            aria-label={on ? "Stop dictation" : "Dictate"}
            onClick={toggle}
            className={cn(on && "text-red-600 dark:text-red-400")}
          />
        }
      >
        {on ? <MicOff /> : <Mic />}
      </TooltipTrigger>
      <TooltipContent>{on ? "Listening… click to stop" : "Dictate"}</TooltipContent>
    </Tooltip>
  );
}

/** The Context pattern: what this chat has spent so far, by mode. */
function UsageButton({ usage }: { usage: ReturnType<typeof chatUsage> }) {
  const max = Math.max(usage.total, 0.0001);
  return (
    <HoverCard>
      <HoverCardTrigger delay={10} closeDelay={100} render={<Button variant="ghost" size="xs" className="font-normal text-muted-foreground tabular-nums" />}>
        {usd(usage.total)}
      </HoverCardTrigger>
      <HoverCardContent className="flex w-60 flex-col gap-3">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium">This chat</span>
          <span className="text-muted-foreground">
            {usage.turns} {usage.turns === 1 ? "turn" : "turns"}
          </span>
        </div>
        {MODES.map((m) => (
          <div key={m.id} className="flex flex-col gap-1 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">{m.label}</span>
              <span className="tabular-nums">{usd(usage.byMode[m.id])}</span>
            </div>
            <Progress value={(usage.byMode[m.id] / max) * 100} aria-label={`${m.label} spend`} />
          </div>
        ))}
      </HoverCardContent>
    </HoverCard>
  );
}

/** Suggestion chips above the composer. */
export function Suggestions({ items, onPick }: { items: string[]; onPick: (s: string) => void }) {
  if (!items.length) return null;
  return (
    <div className="flex scroll-fade-x scrollbar-none gap-2 overflow-x-auto overscroll-x-contain pb-0.5">
      {items.map((s) => (
        <Button key={s} variant="outline" size="sm" className="shrink-0 rounded-full font-normal" onClick={() => onPick(s)}>
          {s}
        </Button>
      ))}
    </div>
  );
}

/**
 * The Studio composer: Prompt Input with the mode menu, Model Selector, dictation and usage.
 * While a turn runs, sending steers it.
 */
export function Composer({
  mode,
  onModeChange,
  model,
  onModelChange,
  modelLocked,
  working,
  usage,
  onSubmit,
  textareaRef,
  autoFocus,
  placeholder,
}: {
  mode: ChatMode;
  onModeChange: (m: ChatMode) => void;
  model?: string;
  onModelChange: (m: string | undefined) => void;
  modelLocked: boolean;
  working: boolean;
  usage?: ReturnType<typeof chatUsage>;
  onSubmit: (text: string) => Promise<boolean>;
  textareaRef?: React.Ref<HTMLTextAreaElement>;
  autoFocus?: boolean;
  placeholder?: string;
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const canSend = text.trim().length > 0 && !sending;
  const submit = async () => {
    if (!canSend) return;
    setSending(true);
    const ok = await onSubmit(text.trim());
    setSending(false);
    if (ok) setText("");
  };
  const hint = working
    ? "Steer the agent: it reads this while it works…"
    : (placeholder ??
      (mode === "build" ? "Ask Kiln to build or change something…" : mode === "chat" ? "Ask a question about your app…" : "Describe what to plan…"));
  return (
    <PromptInput
      value={text}
      onChange={setText}
      onSubmit={() => void submit()}
      canSend={canSend}
      label="Message"
      sendLabel={working ? "Steer" : "Send"}
      placeholder={hint}
      autoFocus={autoFocus}
      textareaRef={textareaRef}
      textareaClassName="max-h-60 min-h-16"
      header={
        working ? (
          <span className="flex items-center gap-1.5 text-xs font-normal text-muted-foreground">
            <span className="size-1.5 animate-pulse rounded-full bg-violet-500" />
            Working. A message now steers this turn.
          </span>
        ) : undefined
      }
      trailing={
        <>
          {usage && usage.turns > 0 && <UsageButton usage={usage} />}
          <DictationButton onText={(t) => setText((prev) => (prev ? `${prev} ${t}` : t))} />
        </>
      }
      tools={
        <>
          <ModeMenu mode={mode} onChange={onModeChange} />
          <ModelSelector model={model} onChange={onModelChange} locked={modelLocked} />
        </>
      }
    />
  );
}
