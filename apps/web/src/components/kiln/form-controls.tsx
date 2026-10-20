"use client";

import { useId, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Copy, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const chip = "inline-flex h-9 items-center gap-1.5 rounded-md bg-muted px-2.5 text-sm font-medium text-foreground outline-none hover:bg-muted/80 focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 data-[placeholder=true]:font-normal data-[placeholder=true]:text-muted-foreground";

/** Grey filled inline select used in trigger sentences ("created ⌄", "in ⌄", "Weekly ⌄"). */
export function ChipSelect<T extends string>({
  value,
  options,
  onChange,
  label,
  className,
  disabled,
  menuLabel,
}: {
  value: T;
  options: { value: T; label: string; hint?: string }[];
  onChange: (v: T) => void;
  label: string;
  className?: string;
  disabled?: boolean;
  menuLabel?: string;
}) {
  const current = options.find((o) => o.value === value);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger aria-label={label} disabled={disabled} className={cn(chip, className)}>
        <span className="truncate">{current?.label ?? value}</span>
        <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="max-h-80 min-w-36 overflow-y-auto">
        {menuLabel && <DropdownMenuLabel>{menuLabel}</DropdownMenuLabel>}
        {options.map((o) => (
          <DropdownMenuItem key={o.value} onClick={() => onChange(o.value)}>
            <span className="flex-1">{o.label}</span>
            {o.hint && <span className="text-xs text-muted-foreground">{o.hint}</span>}
            {o.value === value && <Check className="size-4 text-violet-600 dark:text-violet-400" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Multi-value picker with removable tokens. Suggestions come first; anything typed can be added
 * with Enter (manual entry fallback). `free` hides the dropdown and only takes typed values.
 */
export function TokenPicker({
  values,
  onChange,
  suggestions = [],
  placeholder,
  label,
  free,
  numeric,
  className,
  emptyHint,
  single,
  validate,
}: {
  values: string[];
  onChange: (v: string[]) => void;
  suggestions?: { value: string; label?: string }[] | string[];
  placeholder: string;
  label: string;
  free?: boolean;
  numeric?: boolean;
  className?: string;
  emptyHint?: string;
  single?: boolean;
  validate?: (v: string) => string | null;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const opts = useMemo(() => suggestions.map((s) => (typeof s === "string" ? { value: s, label: s } : { value: s.value, label: s.label ?? s.value })), [suggestions]);
  const labelOf = (v: string) => opts.find((o) => o.value === v)?.label ?? v;
  const add = (raw: string) => {
    const v = raw.trim();
    if (!v) return;
    if (numeric && !/^\d+$/.test(v)) return setError("Enter a number");
    const problem = validate?.(v);
    if (problem) return setError(problem);
    setError(null);
    if (!values.includes(v)) onChange(single ? [v] : [...values, v]);
    setQ("");
    if (single) setOpen(false);
  };
  const remove = (v: string) => onChange(values.filter((x) => x !== v));
  const filtered = opts.filter((o) => !values.includes(o.value) && (!q || o.label.toLowerCase().includes(q.toLowerCase()) || o.value.toLowerCase().includes(q.toLowerCase())));
  const tokens = (
    <>
      {values.map((v) => (
        <span key={v} className="inline-flex max-w-full items-center gap-1 rounded-md bg-background px-2 py-0.5 text-sm font-medium shadow-xs ring-1 ring-border">
          <span className="truncate">{labelOf(v)}</span>
          <button type="button" aria-label={`Remove ${labelOf(v)}`} className="text-muted-foreground hover:text-foreground" onClick={(e) => (e.stopPropagation(), remove(v))}>
            <X className="size-3.5" />
          </button>
        </span>
      ))}
    </>
  );
  if (free) {
    return (
      <div className={cn("flex min-h-9 flex-wrap items-center gap-1.5 rounded-md bg-muted px-2 py-1", className)} onClick={() => input.current?.focus()}>
        {tokens}
        <input
          ref={input}
          aria-label={label}
          value={q}
          onChange={(e) => (setQ(e.target.value), setError(null))}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              add(q);
            } else if (e.key === "Backspace" && !q && values.length) remove(values[values.length - 1]!);
          }}
          onBlur={() => add(q)}
          placeholder={values.length ? "" : placeholder}
          className="min-w-24 flex-1 bg-transparent py-1 text-sm outline-none placeholder:text-muted-foreground"
        />
        {error && <span className="w-full text-xs text-destructive">{error}</span>}
      </div>
    );
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        nativeButton={false}
        render={<div role="combobox" tabIndex={0} aria-controls={listId} aria-expanded={open} aria-label={label} />}
        className={cn("flex min-h-9 w-full cursor-pointer flex-wrap items-center gap-1.5 rounded-md bg-muted py-1 pr-2 pl-2.5 text-left text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50", className)}
      >
        {values.length ? tokens : <span className="text-muted-foreground">{placeholder}</span>}
        <ChevronDown className="ml-auto size-4 shrink-0 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent id={listId} align="start" className="w-(--anchor-width) min-w-64 gap-1 p-1">
        <input
          autoFocus
          aria-label={`Search ${label}`}
          value={q}
          onChange={(e) => (setQ(e.target.value), setError(null))}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add(filtered[0] && !q ? filtered[0].value : q);
            }
          }}
          placeholder={numeric ? "Type a number and press Enter" : "Search or type a value and press Enter"}
          className="h-8 rounded-md border bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        />
        {error && <p className="px-2 text-xs text-destructive">{error}</p>}
        <div className="max-h-60 overflow-y-auto">
          {filtered.map((o) => (
            <button key={o.value} type="button" className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent" onClick={() => add(o.value)}>
              <span className="truncate">{o.label}</span>
              {o.label !== o.value && <span className="ml-auto truncate text-xs text-muted-foreground">{o.value}</span>}
            </button>
          ))}
          {q.trim() && !opts.some((o) => o.value === q.trim()) && (
            <button type="button" className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent" onClick={() => add(q)}>
              <Plus className="size-4 text-muted-foreground" /> Add “{q.trim()}”
            </button>
          )}
          {!filtered.length && !q.trim() && <p className="px-2 py-1.5 text-xs text-muted-foreground">{emptyHint ?? "No suggestions. Type a value and press Enter."}</p>}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Slider with a numeric input, as on the scorer config (pass threshold, sample rate). */
export function SliderField({ value, onChange, min, max, step, suffix, label, decimals = 0 }: { value: number; onChange: (v: number) => void; min: number; max: number; step: number; suffix?: string; label: string; decimals?: number }) {
  const [text, setText] = useState<string | null>(null);
  const pctFill = ((value - min) / (max - min)) * 100;
  return (
    <div className="flex items-center gap-6">
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full outline-none [&::-moz-range-thumb]:size-5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-foreground [&::-moz-range-thumb]:bg-background [&::-webkit-slider-thumb]:size-5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-foreground [&::-webkit-slider-thumb]:bg-background focus-visible:[&::-webkit-slider-thumb]:ring-3 focus-visible:[&::-webkit-slider-thumb]:ring-ring/50"
        style={{ background: `linear-gradient(to right, var(--foreground) ${pctFill}%, var(--muted) ${pctFill}%)` }}
      />
      <div className="relative w-[100px]">
        <input
          aria-label={`${label} value`}
          inputMode="decimal"
          value={text ?? value.toFixed(decimals)}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => {
            const n = Number(text);
            if (text !== null && Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n)));
            setText(null);
          }}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          className="h-10 w-full rounded-lg border bg-background px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        />
        {suffix && <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-muted-foreground">{suffix}</span>}
      </div>
    </div>
  );
}

export function CopyButton({ value, label = "Copy", className, variant = "outline" }: { value: string; label?: string; className?: string; variant?: "outline" | "ghost" }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      type="button"
      variant={variant}
      size="sm"
      className={className}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          toast.error("Could not copy to the clipboard");
        }
      }}
    >
      {done ? <Check /> : <Copy />} {label}
    </Button>
  );
}

/** Label + helper text above a form control, as on the scorer and benchmark forms. */
export function Field({ label, help, required, error, children, className, htmlFor }: { label: string; help?: React.ReactNode; required?: boolean; error?: string; children: React.ReactNode; className?: string; htmlFor?: string }) {
  return (
    <div className={cn("space-y-2", className)}>
      <div>
        <label htmlFor={htmlFor} className="text-sm font-medium">
          {label}
          {required && <span aria-hidden>*</span>}
        </label>
        {help && <p className="mt-0.5 text-xs text-muted-foreground">{help}</p>}
      </div>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
