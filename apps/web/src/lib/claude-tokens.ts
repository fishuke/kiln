import type { PoolEntry } from "@kiln/sdk-ts";

type Window = NonNullable<PoolEntry["fiveHour"]>;

/** Badge text and tone for a token's status. */
export function tokenStatus(e: Pick<PoolEntry, "status">): { label: string; tone: "green" | "grey" | "amber" | "red" } {
  switch (e.status) {
    case "ok":
      return { label: "Working", tone: "green" };
    case "limited":
      return { label: "Limit reached", tone: "amber" };
    case "invalid":
      return { label: "Rejected", tone: "red" };
    default:
      return { label: "Not used yet", tone: "grey" };
  }
}

/** "in 2h 10m", "in 3d 4h", "now". */
export function resetsIn(iso: string | undefined, now = new Date()): string | undefined {
  if (!iso) return undefined;
  const ms = Date.parse(iso) - now.getTime();
  if (ms <= 0) return "now";
  const m = Math.round(ms / 60_000);
  if (m < 60) return `in ${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `in ${h}h ${m % 60}m`;
  return `in ${Math.floor(h / 24)}d ${h % 24}h`;
}

/** "42% used · resets in 2h 10m" */
export function usageLine(w: Window | undefined, now = new Date()): string | undefined {
  if (!w) return undefined;
  const reset = resetsIn(w.resetsAt, now);
  return `${Math.round(w.utilization * 100)}% used${reset ? ` · resets ${reset}` : ""}`;
}

/** The pool's order on screen: the one Kiln would pick next first. */
export function byHeadroom(entries: PoolEntry[]): PoolEntry[] {
  const rank = (e: PoolEntry) => (e.status === "ok" || e.status === "unknown" ? 0 : e.status === "limited" ? 1 : 2);
  const load = (e: PoolEntry) => Math.max(e.fiveHour?.utilization ?? 0, e.sevenDay?.utilization ?? 0);
  return [...entries].sort((a, b) => rank(a) - rank(b) || load(a) - load(b) || a.name.localeCompare(b.name));
}

/** A usage window's name as `claude /usage` shows it: "seven_day_fable" → "Current week (Fable)". */
export function windowTitle(key: string): { long: string; short: string } {
  const [, span, model] = /^(five_hour|seven_day)(?:_(.+))?$/.exec(key) ?? [];
  const name = (model ?? key).split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
  if (!span) return { long: name, short: name };
  const long = span === "five_hour" ? "Current session" : "Current week";
  const short = span === "five_hour" ? "5h" : "7d";
  return model ? { long: `${long} (${name})`, short: `${short} ${name}` } : { long, short };
}
