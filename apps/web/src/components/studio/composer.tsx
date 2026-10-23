"use client";

import { AudioLines, Check, ChevronDown, CircleAlert, Hammer, ListChecks, LoaderCircle, MessageCircle, Mic, MicOff, PhoneOff } from "lucide-react";
import Link from "next/link";
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
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { InputGroupButton } from "@/components/ui/input-group";
import { Kbd } from "@/components/ui/kbd";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { harnessLabel, modelLabel, modelsFor } from "@/lib/agent-catalog";
import { MODES, usd, type chatUsage } from "@/lib/studio/model";
import type { ChatMode } from "@/lib/studio/types";
import type { Voice } from "@/lib/studio/voice";
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

export function modelName(id: string | undefined, harness = "claude-code"): string {
  return id ? modelLabel(id) : `${harnessLabel(harness)} default`;
}

/** Model Selector. A chat keeps its model, so it's locked once the chat has turns. */
function ModelSelector({ model, onChange, locked, harness }: { model?: string; onChange: (m: string | undefined) => void; locked: boolean; harness: string }) {
  const trigger = (
    <InputGroupButton
      size="xs"
      variant="ghost"
      disabled={locked}
      aria-label={`Model: ${modelName(model, harness)}`}
      className="gap-1 px-2 text-muted-foreground"
    >
      {modelName(model, harness)}
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
      <DropdownMenuContent align="start" className="max-h-80 w-56 overflow-y-auto">
        <DropdownMenuRadioGroup value={model ?? ""} onValueChange={(v: string) => onChange(v || undefined)}>
          <DropdownMenuGroup>
            <DropdownMenuLabel>Model</DropdownMenuLabel>
            <DropdownMenuRadioItem value="" closeOnClick>
              {modelName(undefined, harness)}
            </DropdownMenuRadioItem>
            {modelsFor(harness).map((m) => (
              <DropdownMenuRadioItem key={m.id} value={m.id} closeOnClick>
                {m.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuGroup>
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
      <TooltipContent>{on ? "Stop dictation" : "Dictate"}</TooltipContent>
    </Tooltip>
  );
}

/** The team settings section where OpenAI's key goes (ADR-007); GPT-Live runs on it. */
export const MODEL_KEYS_HREF = "/team#model-keys";

/**
 * Talk (ADR-013): a full-duplex voice session with this chat. Idle shows the button; live shows a
 * pulsing pill with mute and end; a failed start shows why, with a link to add an OpenAI key.
 */
function TalkButton({ voice }: { voice: Voice }) {
  const { state } = voice;
  if (state.phase === "live" || state.phase === "ending")
    return (
      <div
        role="group"
        aria-label="Voice session"
        className="flex h-6 items-center gap-0.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 pr-0.5 pl-2 text-emerald-700 dark:text-emerald-300"
      >
        <span className="relative mr-1 flex size-2">
          <span
            className={cn("absolute inline-flex size-full rounded-full bg-emerald-500 opacity-75", !state.muted && state.status !== "idle" && "animate-ping")}
          />
          <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
        </span>
        <span className="mr-1 text-xs font-medium">{state.phase === "ending" ? "Ending" : state.status === "idle" ? "Listening paused" : "Live"}</span>
        <Tooltip>
          <TooltipTrigger
            render={
              <InputGroupButton
                size="icon-xs"
                variant="ghost"
                aria-pressed={state.muted}
                aria-label={state.muted ? "Unmute" : "Mute"}
                disabled={state.phase === "ending"}
                onClick={() => voice.setMuted(!state.muted)}
                className="rounded-full"
              />
            }
          >
            {state.muted ? <MicOff /> : <Mic />}
          </TooltipTrigger>
          <TooltipContent>{state.muted ? "Unmute" : "Mute"}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <InputGroupButton
                size="icon-xs"
                variant="ghost"
                aria-label="End voice"
                disabled={state.phase === "ending"}
                onClick={voice.end}
                className="rounded-full"
              />
            }
          >
            {state.phase === "ending" ? <LoaderCircle className="animate-spin" /> : <PhoneOff />}
          </TooltipTrigger>
          <TooltipContent>End voice</TooltipContent>
        </Tooltip>
      </div>
    );
  if (state.phase === "connecting")
    return (
      <Tooltip>
        <TooltipTrigger
          render={<InputGroupButton size="xs" variant="ghost" aria-label="Cancel voice" onClick={voice.end} className="gap-1 px-2 text-muted-foreground" />}
        >
          <LoaderCircle className="animate-spin" />
          Connecting
        </TooltipTrigger>
        <TooltipContent>Cancel</TooltipContent>
      </Tooltip>
    );
  if (state.phase === "error")
    return (
      <Popover open onOpenChange={(open) => !open && voice.dismissError()}>
        <PopoverTrigger
          render={<InputGroupButton size="xs" variant="ghost" aria-label="Voice didn't start" className="gap-1 px-2 text-red-600 dark:text-red-400" />}
        >
          <CircleAlert />
          Talk
        </PopoverTrigger>
        <PopoverContent align="end" className="w-72 gap-2 p-3">
          <div className="text-sm font-medium">Voice didn&apos;t start</div>
          <p className="text-sm text-muted-foreground">{state.error?.message}</p>
          <div className="flex justify-end gap-2 pt-1">
            {state.error?.code === "no_openai_key" ? (
              <Button size="sm" render={<Link href={MODEL_KEYS_HREF} />} nativeButton={false}>
                Add an OpenAI key
              </Button>
            ) : (
              <Button size="sm" variant="outline" onClick={voice.start}>
                Try again
              </Button>
            )}
          </div>
        </PopoverContent>
      </Popover>
    );
  return (
    <Tooltip>
      <TooltipTrigger render={<InputGroupButton size="icon-xs" variant="ghost" aria-label="Talk" onClick={voice.start} />}>
        <AudioLines />
      </TooltipTrigger>
      <TooltipContent>Talk to this chat</TooltipContent>
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

/**
 * The Studio composer: Prompt Input with the mode menu, Model Selector, dictation, Talk and usage.
 * While a turn runs, sending steers it.
 */
export function Composer({
  mode,
  onModeChange,
  model,
  onModelChange,
  modelLocked,
  harness = "claude-code",
  working,
  usage,
  onSubmit,
  textareaRef,
  autoFocus,
  placeholder,
  voice,
}: {
  mode: ChatMode;
  onModeChange: (m: ChatMode) => void;
  model?: string;
  onModelChange: (m: string | undefined) => void;
  modelLocked: boolean;
  harness?: string;
  working: boolean;
  usage?: ReturnType<typeof chatUsage>;
  onSubmit: (text: string) => Promise<boolean>;
  textareaRef?: React.Ref<HTMLTextAreaElement>;
  autoFocus?: boolean;
  placeholder?: string;
  /** The page's voice session; Talk shows when it's given. */
  voice?: Voice;
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
    ? "Steer the running turn"
    : (placeholder ?? (mode === "build" ? "Describe a change" : mode === "chat" ? "Ask a question" : "Describe what to plan"));
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
      trailing={
        <>
          {usage && usage.turns > 0 && <UsageButton usage={usage} />}
          <DictationButton onText={(t) => setText((prev) => (prev ? `${prev} ${t}` : t))} />
          {voice && <TalkButton voice={voice} />}
        </>
      }
      tools={
        <>
          <ModeMenu mode={mode} onChange={onModeChange} />
          <ModelSelector model={model} onChange={onModelChange} locked={modelLocked} harness={harness} />
        </>
      }
    />
  );
}
