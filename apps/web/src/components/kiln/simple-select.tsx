"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

export type Option = { value: string; label: string; hint?: string };

/** A select over a short list of options that shows the option label (not the raw value). */
export function SimpleSelect({
  value,
  onChange,
  options,
  placeholder,
  disabled,
  className,
  size = "default",
  ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  options: Option[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  size?: "sm" | "default";
  ariaLabel?: string;
}) {
  return (
    <Select items={options.map((o) => ({ value: o.value, label: o.label }))} value={value} onValueChange={(v) => v !== null && onChange(String(v))} disabled={disabled}>
      <SelectTrigger size={size} aria-label={ariaLabel} className={cn("w-full bg-background", className)}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.hint ? (
              <span className="flex flex-col">
                <span>{o.label}</span>
                <span className="text-xs text-muted-foreground">{o.hint}</span>
              </span>
            ) : (
              o.label
            )}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
