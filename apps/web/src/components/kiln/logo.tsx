import { cn } from "@/lib/utils";

/** The Kiln mark: two slanted bars in a rounded square. Colours come from the className. */
export function KilnMark({ className }: { className?: string }) {
  return (
    <span className={cn("flex size-7 items-center justify-center rounded-md bg-foreground text-background", className)}>
      <svg viewBox="0 0 16 16" className="size-[60%]" fill="currentColor" aria-hidden>
        <path d="M3 13.5 6.2 2.5h2.6L5.6 13.5zM7.4 13.5l3.2-11h2.6l-3.2 11z" />
      </svg>
    </span>
  );
}
