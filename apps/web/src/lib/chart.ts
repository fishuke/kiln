/** Small, dependency-free chart math: nice axes, scales, day buckets, stacking and SVG paths. */

const DAY = 86_400_000;

/** Rounds `max` up to a "nice" axis top with `count` equal steps (1, 2, 2.5, 5 × 10^n). Zero data gives 0..count. */
export function niceScale(max: number, count = 4): { top: number; step: number; ticks: number[] } {
  if (!Number.isFinite(max) || max <= 0) return { top: count, step: 1, ticks: Array.from({ length: count + 1 }, (_, i) => i) };
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw - 1e-12) ?? 10 * mag;
  const top = step * count;
  return { top, step, ticks: Array.from({ length: count + 1 }, (_, i) => round(i * step)) };
}

const round = (n: number) => Math.round(n * 1e9) / 1e9;

/** Maps a domain onto a pixel range; works inverted (e.g. [height, 0]) too. */
export function scaleLinear(domain: [number, number], range: [number, number]) {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const k = d1 === d0 ? 0 : (r1 - r0) / (d1 - d0);
  return (v: number) => r0 + (v - d0) * k;
}

/** UTC day keys (YYYY-MM-DD) from start to end inclusive. */
export function dayKeys(start: Date, end: Date): string[] {
  const out: string[] = [];
  const s = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
  const e = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
  for (let t = s; t <= e; t += DAY) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const dayLabel = (key: string) => `${MONTHS[Number(key.slice(5, 7)) - 1]} ${Number(key.slice(8, 10))}`;

export type Row = { key: string } & Record<string, number | string>;

/** Sums `value(item)` per day and series; days and series without data are 0. */
export function bucket<T>(items: T[], days: string[], at: (t: T) => string | undefined, series: (t: T) => string | null, value: (t: T) => number = () => 1, seriesOrder: string[] = []): { rows: Row[]; series: string[] } {
  const names = new Set(seriesOrder);
  const rows = new Map(days.map((d) => [d, { key: d } as Row]));
  for (const it of items) {
    const when = at(it);
    const s = series(it);
    if (!when || s === null) continue;
    const row = rows.get(when.slice(0, 10));
    if (!row) continue;
    names.add(s);
    row[s] = ((row[s] as number | undefined) ?? 0) + value(it);
  }
  const list = [...names];
  for (const r of rows.values()) for (const n of list) r[n] = round((r[n] as number | undefined) ?? 0);
  return { rows: [...rows.values()], series: list };
}

/** Stacks series bottom-up: returns per series the [y0, y1] pair per row. */
export function stack(rows: Row[], keys: string[]): Record<string, [number, number][]> {
  const base = rows.map(() => 0);
  const out: Record<string, [number, number][]> = {};
  for (const k of keys) {
    out[k] = rows.map((r, i) => {
      const y0 = base[i]!;
      const y1 = y0 + Number(r[k] ?? 0);
      base[i] = y1;
      return [y0, y1];
    });
  }
  return out;
}

export function linePath(points: [number, number][]): string {
  return points.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`).join("");
}

/** Closed area between an upper and a lower line (both left to right). */
export function areaPath(upper: [number, number][], lower: [number, number][]): string {
  if (!upper.length) return "";
  return `${linePath(upper)}${[...lower].reverse().map(([x, y]) => `L${x.toFixed(2)},${y.toFixed(2)}`).join("")}Z`;
}

/** Percentage change between two periods; null when there is no previous value. */
export function delta(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0) return null;
  return (current - previous) / Math.abs(previous);
}

export type RangeKey = "7d" | "30d" | "90d" | "custom";
export type DateRange = { key: RangeKey; start: Date; end: Date; prevStart: Date; prevEnd: Date; label: string };

/** Parses `?range=7d|30d|90d` or `?from=YYYY-MM-DD&to=YYYY-MM-DD`; the previous period has the same length. */
export function parseRange(params: { range?: string; from?: string; to?: string }, now = new Date()): DateRange {
  const endOfDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999));
  const valid = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00Z`) : null);
  const from = valid(params.from);
  const to = valid(params.to);
  if (from && to && from <= to) {
    const end = endOfDay(to);
    const len = end.getTime() - from.getTime();
    return { key: "custom", start: from, end, prevEnd: new Date(from.getTime() - 1), prevStart: new Date(from.getTime() - 1 - len), label: `${dayLabel(params.from!)} – ${dayLabel(params.to!)}` };
  }
  const days = params.range === "30d" ? 30 : params.range === "90d" ? 90 : 7;
  const end = endOfDay(now);
  const start = new Date(end.getTime() - days * DAY + 1);
  return { key: `${days}d` as RangeKey, start, end, prevEnd: new Date(start.getTime() - 1), prevStart: new Date(start.getTime() - days * DAY), label: `Last ${days} days` };
}

/** Evenly spaced label indexes so at most `max` x-axis labels show (first and last always). */
export function labelIndexes(n: number, max = 7): number[] {
  if (n <= max) return Array.from({ length: n }, (_, i) => i);
  const step = (n - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => Math.round(i * step));
}
