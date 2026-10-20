"use client";

import { Search } from "lucide-react";
import { forwardRef, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/** 32x32 bordered icon button used in page top bars. */
export const HeaderIconButton = forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement>>(function HeaderIconButton({ className, ...props }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      className={cn("flex size-8 items-center justify-center rounded-md border bg-background text-muted-foreground hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground data-popup-open:bg-muted dark:bg-muted/20 [&_svg]:size-4", className)}
      {...props}
    />
  );
});

/** Magnifier that expands into an inline search field; Escape collapses it. */
export function HeaderSearch({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  const [open, setOpen] = useState(Boolean(value));
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open) ref.current?.focus();
  }, [open]);
  if (!open)
    return (
      <HeaderIconButton aria-label="Search" onClick={() => setOpen(true)}>
        <Search />
      </HeaderIconButton>
    );
  return (
    <div className="flex h-8 w-[180px] items-center gap-1.5 rounded-md border bg-background px-2 focus-within:ring-2 focus-within:ring-ring/40 dark:bg-muted/20">
      <Search className="size-4 shrink-0 text-muted-foreground" />
      <input
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            onChange("");
            setOpen(false);
          }
        }}
        onBlur={() => !value && setOpen(false)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
      />
    </div>
  );
}

/** Search field at the top of a filter submenu. Keeps typing from moving menu focus. */
export function MenuSearch({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="mb-1 flex h-8 items-center gap-2 rounded-md px-2 ring-1 ring-border focus-within:ring-2 focus-within:ring-ring">
      <Search className="size-3.5 text-muted-foreground" />
      <input value={value} onChange={(e) => onChange(e.target.value)} onKeyDown={(e) => e.stopPropagation()} placeholder={placeholder} aria-label={placeholder} className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground" />
    </div>
  );
}
