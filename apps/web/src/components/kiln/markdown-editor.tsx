"use client";

import { useState } from "react";
import { Markdown } from "@/components/kiln/markdown";
import { cn } from "@/lib/utils";

/** Markdown textarea with a Write / Preview switch. Preview renders through the safe renderer. */
export function MarkdownEditor({
  value,
  onChange,
  placeholder,
  label,
  minHeight = 440,
  className,
  invalid,
  readOnly,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  label: string;
  minHeight?: number;
  className?: string;
  invalid?: boolean;
  readOnly?: boolean;
}) {
  const [mode, setMode] = useState<"write" | "preview">("write");
  return (
    <div className={cn("relative rounded-lg border bg-background focus-within:ring-3 focus-within:ring-ring/50", invalid && "border-destructive", className)}>
      <div className="absolute top-2 right-2 z-[1] flex gap-0.5 rounded-md bg-muted p-0.5 text-xs">
        {(["write", "preview"] as const).map((m) => (
          <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)} className={cn("rounded px-2 py-0.5 capitalize", mode === m ? "bg-background font-medium shadow-xs" : "text-muted-foreground hover:text-foreground")}>
            {m}
          </button>
        ))}
      </div>
      {mode === "write" ? (
        <textarea
          aria-label={label}
          value={value}
          readOnly={readOnly}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          style={{ minHeight }}
          className="block w-full resize-y rounded-lg bg-transparent px-4 py-3 pr-32 text-sm leading-relaxed outline-none placeholder:text-muted-foreground"
        />
      ) : (
        <div style={{ minHeight }} className="px-4 py-3 pr-32">
          {value.trim() ? <Markdown className="text-sm">{value}</Markdown> : <p className="text-sm text-muted-foreground">Nothing to preview.</p>}
        </div>
      )}
    </div>
  );
}
