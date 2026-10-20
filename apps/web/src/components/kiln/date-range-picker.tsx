"use client";

import { useState } from "react";
import type { DateRange } from "react-day-picker";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { DATE_PRESETS, presetRange } from "@/lib/run-tree";
import { cn } from "@/lib/utils";

const toIso = (d?: Date) => (d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` : undefined);
const fromIso = (s?: string) => {
  if (!s) return undefined;
  const [y, m, d] = s.split("-").map(Number);
  return y && m && d ? new Date(y, m - 1, d) : undefined;
};
const toMdy = (d?: Date) => (d ? `${String(d.getMonth() + 1).padStart(2, "0")} / ${String(d.getDate()).padStart(2, "0")} / ${d.getFullYear()}` : "");
const parseMdy = (s: string) => {
  const m = /^\s*(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{4})\s*$/.exec(s);
  if (!m) return undefined;
  const d = new Date(Number(m[3]), Number(m[1]) - 1, Number(m[2]));
  return Number.isNaN(d.getTime()) ? undefined : d;
};

/** Presets on the left, two months side by side, typed dates and Cancel / Apply in the footer. */
export function DateRangePicker({ from, to, onApply, onCancel }: { from?: string; to?: string; onApply: (r: { from?: string; to?: string }) => void; onCancel: () => void }) {
  const [range, setRange] = useState<DateRange | undefined>(from || to ? { from: fromIso(from), to: fromIso(to) } : undefined);
  const [month, setMonth] = useState<Date>(() => {
    const base = fromIso(to) ?? new Date();
    return new Date(base.getFullYear(), base.getMonth() - 1, 1);
  });
  const [startText, setStartText] = useState(toMdy(range?.from));
  const [endText, setEndText] = useState(toMdy(range?.to));

  const set = (r: DateRange | undefined) => {
    setRange(r);
    setStartText(toMdy(r?.from));
    setEndText(toMdy(r?.to));
  };

  return (
    <div className="flex max-w-[calc(100vw-2rem)] overflow-x-auto">
      <ul className="flex w-36 shrink-0 flex-col gap-0.5 border-r p-2">
        {DATE_PRESETS.map((p) => (
          <li key={p}>
            <button
              type="button"
              onClick={() => {
                const r = presetRange(p);
                const next = r.from ? { from: fromIso(r.from), to: fromIso(r.to) } : undefined;
                set(next);
                if (next?.to) setMonth(new Date(next.to.getFullYear(), next.to.getMonth() - 1, 1));
              }}
              className="flex h-9 w-full items-center rounded-md px-3 text-left text-sm hover:bg-muted"
            >
              {p}
            </button>
          </li>
        ))}
      </ul>
      <div className="flex flex-col">
        <Calendar
          mode="range"
          numberOfMonths={2}
          month={month}
          onMonthChange={setMonth}
          selected={range}
          onSelect={set}
          showOutsideDays={false}
          className="p-4 [--cell-size:--spacing(9)]"
          classNames={{ months: "relative flex gap-8", today: "[&>button]:ring-2 [&>button]:ring-foreground [&>button]:rounded-full [&>button]:after:absolute [&>button]:after:bottom-1 [&>button]:after:size-1 [&>button]:after:rounded-full [&>button]:after:bg-violet-500" }}
          modifiersClassNames={{ future: "text-muted-foreground" }}
          modifiers={{ future: { after: new Date() } }}
        />
        <div className="flex items-center gap-3 border-t p-3">
          <DateInput value={startText} onChange={setStartText} onCommit={(d) => set({ from: d, to: range?.to })} label="Start date" />
          <span className="text-muted-foreground">–</span>
          <DateInput value={endText} onChange={setEndText} onCommit={(d) => set({ from: range?.from, to: d })} label="End date" />
          <div className="ml-auto flex gap-2">
            <Button variant="outline" size="lg" onClick={onCancel}>
              Cancel
            </Button>
            <Button size="lg" onClick={() => onApply({ from: toIso(range?.from), to: toIso(range?.to ?? range?.from) })}>
              Apply
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function DateInput({ value, onChange, onCommit, label }: { value: string; onChange: (v: string) => void; onCommit: (d: Date | undefined) => void; label: string }) {
  const valid = !value || parseMdy(value);
  return (
    <input
      aria-label={label}
      value={value}
      placeholder="MM / DD / YYYY"
      onChange={(e) => onChange(e.target.value)}
      onBlur={() => onCommit(parseMdy(value))}
      onKeyDown={(e) => e.key === "Enter" && onCommit(parseMdy(value))}
      className={cn("h-9 w-36 rounded-md border bg-background px-3 text-sm tabular-nums outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring/40", !valid && "border-destructive")}
    />
  );
}

export function formatRange(from?: string, to?: string): string | undefined {
  if (!from && !to) return undefined;
  const fmt = (s?: string) => (s ? fromIso(s)!.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "…");
  return from === to ? fmt(from) : `${fmt(from)} – ${fmt(to)}`;
}
