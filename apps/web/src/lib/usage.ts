/** Formatting for usage and spend limits (sidebar footer, /settings/usage). */

export type UsageLimit = { monthlyUsd: number; autoStop: boolean; spentThisMonthUsd: number; remainingUsd: number; exceeded: boolean };
export type UsageTone = "ok" | "warn" | "over";

/** "$0.30", "$12.40", "$1,250" — cents below $1,000, whole dollars above. */
export function formatUsd(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  const digits = abs >= 1000 ? 0 : 2;
  const s = abs.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return `${n < 0 ? "-" : ""}$${s}`;
}

/** Share of the monthly limit spent, 0..1 (can exceed 1). A zero limit counts as fully used once anything is spent. */
export function usedFraction(limit: Pick<UsageLimit, "monthlyUsd" | "spentThisMonthUsd">): number {
  if (limit.monthlyUsd <= 0) return limit.spentThisMonthUsd > 0 ? 1 : 0;
  return limit.spentThisMonthUsd / limit.monthlyUsd;
}

export function usageTone(limit: Pick<UsageLimit, "monthlyUsd" | "spentThisMonthUsd" | "exceeded">): UsageTone {
  const f = usedFraction(limit);
  if (limit.exceeded || f >= 1) return "over";
  if (f >= 0.8) return "warn";
  return "ok";
}

/** Sidebar footer: "$X of $Y used". */
export function usageLabel(limit: Pick<UsageLimit, "monthlyUsd" | "spentThisMonthUsd" | "exceeded">): { label: string; tone: UsageTone } {
  return { label: `${formatUsd(limit.spentThisMonthUsd)} of ${formatUsd(limit.monthlyUsd)} used`, tone: usageTone(limit) };
}

/** Progress bar width in percent, clamped to 0..100. */
export function barPercent(value: number, max: number): number {
  if (!(max > 0) || !(value > 0)) return 0;
  return Math.min(100, Math.max(0, (value / max) * 100));
}

export type BreakdownRow = { key: string; costUsd: number; runs: number };

/** Adds each row's share of the total (0..100) and keeps the top `limit` rows, folding the rest into "Other". */
export function withShares(rows: BreakdownRow[], limit = 8): (BreakdownRow & { share: number })[] {
  const total = rows.reduce((s, r) => s + r.costUsd, 0);
  const sorted = [...rows].sort((a, b) => b.costUsd - a.costUsd || a.key.localeCompare(b.key));
  const top = sorted.slice(0, limit);
  const rest = sorted.slice(limit);
  if (rest.length) top.push({ key: "Other", costUsd: rest.reduce((s, r) => s + r.costUsd, 0), runs: rest.reduce((s, r) => s + r.runs, 0) });
  return top.map((r) => ({ ...r, share: total > 0 ? (r.costUsd / total) * 100 : 0 }));
}

/** Every day from `since` to `until` (UTC, inclusive), filling missing days with zero. */
export function fillDays(byDay: BreakdownRow[], since: string, until: string): BreakdownRow[] {
  const map = new Map(byDay.map((d) => [d.key, d]));
  const out: BreakdownRow[] = [];
  const start = new Date(`${since.slice(0, 10)}T00:00:00Z`);
  const end = new Date(`${until.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return byDay;
  for (let d = start; d <= end && out.length < 400; d = new Date(d.getTime() + 86_400_000)) {
    const key = d.toISOString().slice(0, 10);
    out.push(map.get(key) ?? { key, costUsd: 0, runs: 0 });
  }
  return out;
}

/** "Oct 2026" for the period header. */
export function monthLabel(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}
