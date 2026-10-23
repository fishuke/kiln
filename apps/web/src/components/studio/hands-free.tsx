"use client";

import { AudioLines, Bell, CircleCheck, LoaderCircle, Minimize2, PhoneOff } from "lucide-react";
import Link from "next/link";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Button } from "@/components/ui/button";
import { Message, MessageContent } from "@/components/ui/message";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import { Switch } from "@/components/ui/switch";
import type { StatusReport } from "@/lib/studio/types";
import type { Badge, Voice } from "@/lib/studio/voice";
import { cn } from "@/lib/utils";

/** The session's state in a few words. */
function stateLabel(voice: Voice): string {
  const { phase, status, muted } = voice.state;
  if (phase === "connecting") return "Connecting";
  if (phase === "ending") return "Ending";
  if (status === "idle") return "Listening paused";
  return muted ? "Muted" : "Listening";
}

function BadgeItem({ badge, appName }: { badge: Badge; appName?: string }) {
  const needsYou = badge.priority === "needs_you";
  const Icon = needsYou ? Bell : CircleCheck;
  return (
    <Link
      href={`/studio/${encodeURIComponent(badge.appId)}${badge.chatId ? `?chat=${encodeURIComponent(badge.chatId)}` : ""}`}
      className="flex items-start gap-2.5 rounded-lg px-2.5 py-2 text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      <Icon className={cn("mt-0.5 size-4 shrink-0", needsYou ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400")} />
      <span className="flex min-w-0 flex-col gap-0.5">
        {appName && <span className="text-xs font-medium text-muted-foreground">{appName}</span>}
        <span className="line-clamp-2">{badge.text}</span>
      </span>
    </Link>
  );
}

/**
 * The hands-free view (ADR-013: a view, not a mode): a big preview of the focused chat, the live
 * transcript and the needs-you list, with quiet mode and End. "Back to Studio" returns to the
 * normal screen; the session keeps going.
 */
export function HandsFree({ voice, preview, status }: { voice: Voice; preview: React.ReactNode; status?: StatusReport }) {
  const { state } = voice;
  const name = (appId: string) => status?.apps.find((a) => a.id === appId)?.name;
  const needsYou = state.badges.filter((b) => b.priority === "needs_you");
  const finished = state.badges.filter((b) => b.priority === "finished");
  return (
    <div className="flex h-screen min-h-0 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b px-3">
        <span className="flex items-center gap-2 text-sm font-medium">
          <AudioLines className="size-4" />
          Hands-free
        </span>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {state.phase === "connecting" || state.phase === "ending" ? (
            <LoaderCircle className="size-3.5 animate-spin" />
          ) : (
            <span className={cn("size-2 rounded-full", state.status === "idle" || state.muted ? "bg-muted-foreground/50" : "animate-pulse bg-emerald-500")} />
          )}
          {stateLabel(voice)}
        </span>
        {state.phase === "live" && state.status === "idle" && (
          <Button size="sm" variant="outline" onClick={voice.wake}>
            Resume listening
          </Button>
        )}
        <div className="ml-auto flex items-center gap-2">
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <Switch size="sm" checked={state.quiet} onCheckedChange={(q: boolean) => voice.setQuiet(q)} disabled={state.phase !== "live"} />
            Quiet
          </label>
          <Button size="sm" variant="ghost" onClick={() => voice.setHandsFree(false)}>
            <Minimize2 data-icon="inline-start" />
            Back to Studio
          </Button>
          <Button size="sm" variant="outline" onClick={voice.end} disabled={state.phase === "ending"}>
            <PhoneOff data-icon="inline-start" />
            End
          </Button>
        </div>
      </header>
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <section aria-label="Preview" className="min-h-0 min-w-0 flex-1 border-b lg:border-r lg:border-b-0">
          {preview}
        </section>
        <aside className="flex min-h-0 w-full shrink-0 flex-col lg:w-[380px]">
          <section aria-label="Needs you" className="flex max-h-[40%] shrink-0 flex-col gap-1 overflow-y-auto border-b p-3">
            <h2 className="px-2.5 text-xs font-medium text-muted-foreground">Needs you</h2>
            {needsYou.length === 0 && finished.length === 0 && <p className="px-2.5 py-1 text-sm text-muted-foreground">Nothing is waiting on you.</p>}
            {[...needsYou, ...finished].map((b) => (
              <BadgeItem key={`${b.appId}/${b.chatId ?? ""}`} badge={b} appName={name(b.appId)} />
            ))}
          </section>
          <section aria-label="Transcript" className="flex min-h-0 flex-1 flex-col">
            {state.transcript.length === 0 ? (
              <p className="p-5 text-sm text-muted-foreground">Say what you want to do. Your words go to the chat on screen.</p>
            ) : (
              <MessageScrollerProvider autoScroll defaultScrollPosition="end">
                <MessageScroller className="min-h-0 flex-1">
                  <MessageScrollerViewport>
                    <MessageScrollerContent className="gap-3 px-4 py-4">
                      {state.transcript.map((line, i) => (
                        <MessageScrollerItem key={i} messageId={String(i)}>
                          <Message align={line.role === "person" ? "end" : "start"}>
                            <MessageContent>
                              {line.role === "person" ? (
                                <Bubble align="end" variant="muted">
                                  <BubbleContent className="whitespace-pre-wrap">{line.text}</BubbleContent>
                                </Bubble>
                              ) : (
                                <p className="text-sm leading-6 whitespace-pre-wrap">{line.text}</p>
                              )}
                            </MessageContent>
                          </Message>
                        </MessageScrollerItem>
                      ))}
                    </MessageScrollerContent>
                  </MessageScrollerViewport>
                  <MessageScrollerButton />
                </MessageScroller>
              </MessageScrollerProvider>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
