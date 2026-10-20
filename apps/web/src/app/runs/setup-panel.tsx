"use client";

import Link from "next/link";
import { Archive, Brain, Check, ChevronDown, Route, X } from "lucide-react";
import { useEffect, useState } from "react";
import { ForemanGuide } from "@/components/kiln/foreman-guide";
import { cn } from "@/lib/utils";

export type SetupTask = { id: string; title: string; body: string; href: string; done: boolean; icon: "route" | "archive" | "brain" };

const ICONS = { route: Route, archive: Archive, brain: Brain };
const DISMISSED_KEY = "kiln.setup.dismissed";

function readDismissed(): string[] {
  try {
    return JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? "[]") as string[];
  } catch {
    return [];
  }
}

/** Progress ring shown in the "Setup" button. */
export function SetupRing({ done, total }: { done: number; total: number }) {
  const r = 6;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 16 16" className="size-4 -rotate-90" aria-hidden>
      <circle cx="8" cy="8" r={r} fill="none" stroke="currentColor" strokeWidth="2.5" className="text-muted" />
      <circle cx="8" cy="8" r={r} fill="none" stroke="currentColor" strokeWidth="2.5" strokeDasharray={`${(c * done) / Math.max(total, 1)} ${c}`} strokeLinecap="round" className="text-emerald-500" />
    </svg>
  );
}

/** "Let's get your factory set up." aside on the Runs page. */
export function SetupPanel({ tasks, alias }: { tasks: SetupTask[]; alias: string }) {
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [guideOpen, setGuideOpen] = useState(true);
  useEffect(() => setDismissed(readDismissed()), []);
  const dismiss = (id: string) => {
    const next = [...dismissed, id];
    setDismissed(next);
    try {
      localStorage.setItem(DISMISSED_KEY, JSON.stringify(next));
    } catch {
      /* storage unavailable */
    }
  };
  const open = tasks.filter((t) => !t.done && !dismissed.includes(t.id));
  const completed = tasks.filter((t) => t.done);
  return (
    <aside aria-label="Finish setup" className="sticky top-14 hidden h-[calc(100vh-3.5rem)] w-[356px] shrink-0 overflow-y-auto border-l p-4 lg:block">
      <h2 className="mb-3 text-base font-semibold">Let&apos;s get your factory set up.</h2>
      <ul className="flex flex-col gap-3">
        {open.map((t) => {
          const Icon = ICONS[t.icon];
          return (
            <li key={t.id} className="relative rounded-lg bg-muted/70 p-3 hover:bg-muted">
              <Link href={t.href} className="flex gap-2.5 pr-6">
                <Icon className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
                <span>
                  <span className="block text-sm font-medium">{t.title}</span>
                  <span className="mt-0.5 block text-sm text-muted-foreground">{t.body}</span>
                </span>
              </Link>
              <button type="button" aria-label={`Dismiss ${t.title}`} onClick={() => dismiss(t.id)} className="absolute top-2 right-2 flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground">
                <X className="size-4" />
              </button>
            </li>
          );
        })}
        {open.length === 0 && <li className="text-sm text-muted-foreground">You are all set.</li>}
      </ul>
      {completed.length > 0 && (
        <>
          <h3 className="mt-6 mb-3 text-base font-semibold">Completed</h3>
          <ul className="flex flex-col gap-2">
            {completed.map((t) => (
              <li key={t.id} className="flex h-11 items-center gap-2.5 rounded-lg bg-muted/70 px-3 text-sm font-medium">
                <Check className="size-4 text-emerald-600" />
                {t.title}
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="my-6 h-px bg-border" />
      <div className="rounded-lg bg-muted/70 p-4">
        <button type="button" aria-label={guideOpen ? "Collapse usage guide" : "Expand usage guide"} onClick={() => setGuideOpen(!guideOpen)} className="flex w-full items-center justify-between text-sm">
          How to use the factory in your apps
          <ChevronDown className={cn("size-4 text-muted-foreground transition-transform", !guideOpen && "-rotate-90")} />
        </button>
        {guideOpen && (
          <div className="mt-3">
            <ForemanGuide alias={alias} copyable />
          </div>
        )}
      </div>
    </aside>
  );
}
