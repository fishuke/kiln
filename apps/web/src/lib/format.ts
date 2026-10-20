export function timeAgo(iso: string | undefined, now = Date.now()): string {
  if (!iso) return "—";
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function usd(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return n < 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(n >= 100 ? 0 : 2)}`;
}

export function pct(n: number | null | undefined): string {
  return n === null || n === undefined ? "—" : `${Math.round(n * 100)}%`;
}

const LABELS: Record<string, string> = {
  received: "Received",
  triaging: "Triaging",
  planning: "Planning",
  awaiting_spec: "Spec approval",
  building: "Building",
  reviewing: "Reviewing",
  awaiting_preview: "Preview",
  handed_off: "Ready to merge",
  complete: "Complete",
  blocked: "Blocked",
  cancelled: "Cancelled",
  failed: "Failed",
};

export function stateLabel(state: string): string {
  return LABELS[state] ?? state;
}

/** Tailwind classes for a state pill. Waiting-on-a-person states stand out. */
export function stateTone(state: string): string {
  if (["awaiting_spec", "awaiting_preview", "handed_off"].includes(state)) return "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200";
  if (state === "complete") return "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200";
  if (["blocked", "failed"].includes(state)) return "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200";
  if (state === "cancelled") return "bg-muted text-muted-foreground";
  return "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200";
}

export const LIFECYCLE = ["received", "triaging", "planning", "awaiting_spec", "building", "reviewing", "awaiting_preview", "handed_off", "complete"] as const;

export function greeting(d = new Date()): string {
  const h = d.getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}
