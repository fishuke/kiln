/** Three growing bars with a dashed upward arrow: the empty state for self-improvement and benchmarks. */
export function EmptyIllustration() {
  return (
    <svg viewBox="0 0 120 80" className="mb-5 h-24 w-40 text-muted-foreground/50" aria-hidden>
      {[
        [14, 50, 22],
        [48, 36, 36],
        [82, 18, 54],
      ].map(([x, y, h]) => (
        <path key={x} d={`M${x} ${y + 6} l11 -6 l11 6 v${h - 12} l-11 6 l-11 -6 z`} className="fill-current" />
      ))}
      <path d="M20 40 Q60 10 104 8" className="fill-none stroke-current" strokeWidth={2} strokeDasharray="4 4" />
      <path d="M98 4 l8 4 l-7 6" className="fill-none stroke-current" strokeWidth={2} />
    </svg>
  );
}
