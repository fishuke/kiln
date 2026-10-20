/**
 * Schedules are five-field cron expressions (always UTC) or descriptors: @yearly, @annually,
 * @monthly, @weekly, @daily, @midnight, @hourly and `@every <duration>` (e.g. @every 5m, @every 1h30m).
 * A CRON_TZ= or TZ= prefix and the six-field seconds form are rejected.
 */

export class CronError extends Error {}

const DESCRIPTORS: Record<string, string> = {
  "@yearly": "0 0 1 1 *",
  "@annually": "0 0 1 1 *",
  "@monthly": "0 0 1 * *",
  "@weekly": "0 0 * * 0",
  "@daily": "0 0 * * *",
  "@midnight": "0 0 * * *",
  "@hourly": "0 * * * *",
};

const UNIT_MS: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };

/** Parse a Go-style duration such as 90s, 5m, 1h30m. Minimum one minute (the scheduler ticks per minute). */
export function parseEveryDuration(spec: string): number {
  const s = spec.trim();
  if (!/^(\d+(s|m|h|d))+$/.test(s)) throw new CronError(`bad @every duration "${spec}": use units s, m, h or d, e.g. 5m or 1h30m`);
  let ms = 0;
  for (const m of s.matchAll(/(\d+)(s|m|h|d)/g)) ms += Number(m[1]) * UNIT_MS[m[2]!]!;
  if (ms < 60_000) throw new CronError(`@every ${spec} is shorter than one minute`);
  return ms;
}

function field(spec: string, min: number, max: number, name: string): Set<number> {
  const out = new Set<number>();
  for (const part of spec.split(",")) {
    const [range, stepS] = part.split("/");
    const step = stepS !== undefined ? Number(stepS) : 1;
    let [lo, hi] = [min, max];
    if (range !== "*") {
      const [a, b] = range!.split("-").map((x) => (x === "" ? Number.NaN : Number(x)));
      lo = a!;
      hi = b ?? (stepS !== undefined ? max : a!);
    }
    if (!Number.isInteger(lo) || !Number.isInteger(hi) || lo < min || hi > max || lo > hi || !Number.isInteger(step) || step < 1) {
      throw new CronError(`bad cron ${name} field "${spec}" (allowed ${min}-${max})`);
    }
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return out;
}

export type CronSchedule = {
  /** Set for `@every` schedules: fire this many ms after the previous fire. */
  everyMs?: number;
  matches(d: Date): boolean;
  /** First fire time strictly after `after`. */
  next(after: Date): Date;
};

/** Parse a schedule; throws CronError with a message fit for a definition error. */
export function parseCron(expr: string): CronSchedule {
  const raw = expr.trim();
  if (/^(CRON_TZ|TZ)=/i.test(raw)) throw new CronError("schedules are always UTC: remove the CRON_TZ=/TZ= prefix");
  const every = /^@every\s+(\S+)$/.exec(raw);
  if (every) {
    const everyMs = parseEveryDuration(every[1]!);
    return {
      everyMs,
      matches: () => true,
      next: (after: Date) => new Date(after.getTime() + everyMs),
    };
  }
  if (raw.startsWith("@") && !DESCRIPTORS[raw]) throw new CronError(`unknown descriptor ${raw}; use @yearly, @monthly, @weekly, @daily, @hourly or @every <duration>`);
  const parts = (DESCRIPTORS[raw] ?? raw).split(/\s+/);
  if (parts.length === 6) throw new CronError("six-field (seconds) cron is not supported; use five fields");
  if (parts.length !== 5) throw new CronError(`cron needs 5 fields: ${expr}`);
  const [mi, h, dom, mon, dow] = parts as [string, string, string, string, string];
  const sets = {
    mi: field(mi, 0, 59, "minute"),
    h: field(h, 0, 23, "hour"),
    dom: field(dom, 1, 31, "day-of-month"),
    mon: field(mon, 1, 12, "month"),
    dow: new Set([...field(dow, 0, 7, "day-of-week")].map((d) => d % 7)),
  };
  const domStar = dom === "*";
  const dowStar = dow === "*";
  const schedule: CronSchedule = {
    matches(d: Date) {
      const dayOk = domStar && dowStar ? true : domStar ? sets.dow.has(d.getUTCDay()) : dowStar ? sets.dom.has(d.getUTCDate()) : sets.dom.has(d.getUTCDate()) || sets.dow.has(d.getUTCDay());
      return sets.mi.has(d.getUTCMinutes()) && sets.h.has(d.getUTCHours()) && sets.mon.has(d.getUTCMonth() + 1) && dayOk;
    },
    next(after: Date): Date {
      const d = new Date(after);
      d.setUTCSeconds(0, 0);
      for (let i = 0; i < 366 * 24 * 60 * 5; i++) {
        d.setUTCMinutes(d.getUTCMinutes() + 1);
        if (schedule.matches(d)) return new Date(d);
      }
      throw new CronError(`cron ${expr} never fires`);
    },
  };
  return schedule;
}
