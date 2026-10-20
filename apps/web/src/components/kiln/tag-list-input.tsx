"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/** Token input: type a value and press Enter or comma; chips with × remove it. */
export function TagListInput({
  value,
  onChange,
  placeholder,
  disabled,
  validate,
  mono,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
  validate?: (v: string) => string | undefined;
  mono?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string>();
  const add = () => {
    const items = draft
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!items.length) return;
    for (const i of items) {
      const e = validate?.(i);
      if (e) {
        setError(e);
        return;
      }
    }
    onChange([...value, ...items.filter((i) => !value.includes(i))]);
    setDraft("");
    setError(undefined);
  };
  return (
    <div>
      <div className={cn("flex min-h-10 flex-wrap items-center gap-1.5 rounded-lg border border-input bg-background px-2 py-1.5 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50", disabled && "opacity-60")}>
        {value.map((v) => (
          <span key={v} className={cn("inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-xs", mono && "font-mono")}>
            {v}
            {!disabled && (
              <button type="button" aria-label={`Remove ${v}`} onClick={() => onChange(value.filter((x) => x !== v))} className="text-muted-foreground hover:text-foreground">
                <X className="size-3" />
              </button>
            )}
          </span>
        ))}
        <input
          value={draft}
          disabled={disabled}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              add();
            } else if (e.key === "Backspace" && !draft && value.length) onChange(value.slice(0, -1));
          }}
          onBlur={add}
          placeholder={value.length ? "" : placeholder}
          className="min-w-32 flex-1 bg-transparent px-1 text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}
