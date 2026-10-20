"use client";

import { cn } from "@/lib/utils";

/** Pill tab used on detail pages (Settings / Runs, Details / Config). */
export function PillTabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div role="tablist" className="flex gap-1">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          type="button"
          aria-selected={t.id === value}
          onClick={() => onChange(t.id)}
          className={cn("rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors", t.id === value ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground")}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
