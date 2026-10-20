/**
 * Schedules are five-field cron expressions or descriptors and always run in UTC. The editor
 * works in the viewer's local time and converts on the way in and out.
 */

export const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
const SHORT_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const DESCRIPTORS: Record<string, string> = {
  "@yearly": "0 0 1 1 *",
  "@annually": "0 0 1 1 *",
  "@monthly": "0 0 1 * *",
  "@weekly": "0 0 * * 0",
  "@daily": "0 0 * * *",
  "@midnight": "0 0 * * *",
  "@hourly": "0 * * * *",
};

export type Frequency = "hourly" | "daily" | "weekly" | "custom";

/** A schedule as the editor shows it, in local time. */
export type ScheduleForm = { frequency: Frequency; minute: number; hour: number; day: number; cron: string };

const UNIT: Record<string, [number, string]> = { s: [1, "second"], m: [60, "minute"], h: [3600, "hour"], d: [86400, "day"] };

function everySeconds(spec: string): number | null {
  if (!/^(\d+[smhd])+$/.test(spec)) return null;
  let s = 0;
  for (const m of spec.matchAll(/(\d+)([smhd])/g)) s += Number(m[1]) * UNIT[m[2]!]![0];
  return s;
}

export function expandDescriptor(expr: string): string {
  const raw = expr.trim();
  return DESCRIPTORS[raw] ?? raw;
}

function field(spec: string, min: number, max: number): Set<number> | null {
  const out = new Set<number>();
  for (const part of spec.split(",")) {
    const [range, stepS] = part.split("/");
    const step = stepS !== undefined ? Number(stepS) : 1;
    let lo = min;
    let hi = max;
    if (range !== "*") {
      const [a, b] = range!.split("-").map(Number);
      lo = a!;
      hi = b ?? (stepS !== undefined ? max : a!);
    }
    if (![lo, hi, step].every(Number.isInteger) || lo < min || hi > max || lo > hi || step < 1) return null;
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return out;
}

/** Returns a problem with the expression, or null when it is a valid five-field cron or descriptor. */
export function cronProblem(expr: string): string | null {
  const raw = expr.trim();
  if (!raw) return "Enter a cron expression";
  if (/^(CRON_TZ|TZ)=/i.test(raw)) return "Schedules are always UTC: remove the TZ prefix";
  const every = /^@every\s+(\S+)$/.exec(raw);
  if (every) {
    const s = everySeconds(every[1]!);
    if (s === null) return "Use a duration like 5m, 1h or 1h30m";
    return s < 60 ? "@every must be at least one minute" : null;
  }
  if (raw.startsWith("@")) return DESCRIPTORS[raw] ? null : "Unknown descriptor";
  const parts = raw.split(/\s+/);
  if (parts.length === 6) return "Six-field (seconds) cron is not supported";
  if (parts.length !== 5) return "Cron needs five fields: minute hour day-of-month month day-of-week";
  const ranges: [number, number][] = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 7]];
  const names = ["minute", "hour", "day-of-month", "month", "day-of-week"];
  for (let i = 0; i < 5; i++) if (!field(parts[i]!, ranges[i]![0], ranges[i]![1])) return `Invalid ${names[i]} field "${parts[i]}"`;
  return null;
}

/** First fire time strictly after `after` (UTC semantics), or null for invalid expressions. */
export function nextRun(expr: string, after: Date = new Date()): Date | null {
  if (cronProblem(expr)) return null;
  const raw = expr.trim();
  const every = /^@every\s+(\S+)$/.exec(raw);
  if (every) return new Date(after.getTime() + everySeconds(every[1]!)! * 1000);
  const [mi, h, dom, mon, dow] = expandDescriptor(raw).split(/\s+/) as [string, string, string, string, string];
  const s = { mi: field(mi, 0, 59)!, h: field(h, 0, 23)!, dom: field(dom, 1, 31)!, mon: field(mon, 1, 12)!, dow: new Set([...field(dow, 0, 7)!].map((d) => d % 7)) };
  const d = new Date(after);
  d.setUTCSeconds(0, 0);
  for (let i = 0; i < 366 * 24 * 60; i++) {
    d.setUTCMinutes(d.getUTCMinutes() + 1);
    const dayOk = dom === "*" && dow === "*" ? true : dom === "*" ? s.dow.has(d.getUTCDay()) : dow === "*" ? s.dom.has(d.getUTCDate()) : s.dom.has(d.getUTCDate()) || s.dow.has(d.getUTCDay());
    if (dayOk && s.mi.has(d.getUTCMinutes()) && s.h.has(d.getUTCHours()) && s.mon.has(d.getUTCMonth() + 1)) return new Date(d);
  }
  return null;
}

export function formatTime(hour: number, minute: number): string {
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:${String(minute).padStart(2, "0")} ${hour < 12 ? "AM" : "PM"}`;
}

/** Shift a (day, hour, minute) by `offsetMinutes`; day stays -1 for "every day". */
function shift(day: number, hour: number, minute: number, offsetMinutes: number): { day: number; hour: number; minute: number } {
  let total = hour * 60 + minute + offsetMinutes;
  let dayShift = 0;
  while (total < 0) {
    total += 1440;
    dayShift--;
  }
  while (total >= 1440) {
    total -= 1440;
    dayShift++;
  }
  return { day: day < 0 ? -1 : (((day + dayShift) % 7) + 7) % 7, hour: Math.floor(total / 60), minute: total % 60 };
}

/**
 * Parse a UTC cron into the local-time form the editor shows. `offsetMinutes` is local minus UTC
 * (e.g. +120 for GMT+2). Anything that is not hourly/daily/weekly is "custom".
 */
export function scheduleFromCron(cron: string, offsetMinutes = 0): ScheduleForm {
  const raw = cron.trim();
  const custom: ScheduleForm = { frequency: "custom", minute: 0, hour: 9, day: 1, cron: raw };
  if (raw.startsWith("@every") || raw === "@yearly" || raw === "@annually" || raw === "@monthly") return custom;
  const parts = expandDescriptor(raw).split(/\s+/);
  if (parts.length !== 5) return custom;
  const [mi, h, dom, mon, dow] = parts as [string, string, string, string, string];
  const int = (x: string) => (/^\d+$/.test(x) ? Number(x) : null);
  const minute = int(mi);
  if (minute === null || minute > 59 || dom !== "*" || mon !== "*") return custom;
  if (h === "*" && dow === "*") return { frequency: "hourly", minute: shift(-1, 0, minute, offsetMinutes).minute, hour: 9, day: 1, cron: raw };
  const hour = int(h);
  if (hour === null || hour > 23) return custom;
  if (dow === "*") {
    const l = shift(-1, hour, minute, offsetMinutes);
    return { frequency: "daily", minute: l.minute, hour: l.hour, day: 1, cron: raw };
  }
  const day = int(dow);
  if (day === null || day > 7) return custom;
  const l = shift(day % 7, hour, minute, offsetMinutes);
  return { frequency: "weekly", minute: l.minute, hour: l.hour, day: l.day, cron: raw };
}

/** The UTC cron for a local-time form. */
export function cronFromSchedule(s: ScheduleForm, offsetMinutes = 0): string {
  if (s.frequency === "custom") return s.cron.trim();
  if (s.frequency === "hourly") return `${shift(-1, 0, s.minute, -offsetMinutes).minute} * * * *`;
  if (s.frequency === "daily") {
    const u = shift(-1, s.hour, s.minute, -offsetMinutes);
    return `${u.minute} ${u.hour} * * *`;
  }
  const u = shift(s.day, s.hour, s.minute, -offsetMinutes);
  return `${u.minute} ${u.hour} * * ${u.day}`;
}

function plural(n: number, unit: string) {
  return `${n} ${unit}${n === 1 ? "" : "s"}`;
}

/** Human summary such as "Weekly on Mon at 9:00 AM", in the given offset (default UTC). */
export function describeCron(cron: string, offsetMinutes = 0): string {
  const raw = (cron ?? "").trim();
  const every = /^@every\s+(\S+)$/.exec(raw);
  if (every) {
    const secs = everySeconds(every[1]!);
    if (secs === null) return `Every ${every[1]}`;
    if (secs % 86400 === 0) return `Every ${plural(secs / 86400, "day")}`;
    if (secs % 3600 === 0) return `Every ${plural(secs / 3600, "hour")}`;
    if (secs % 60 === 0) return `Every ${plural(secs / 60, "minute")}`;
    return `Every ${every[1]}`;
  }
  if (raw === "@yearly" || raw === "@annually") return "Yearly on Jan 1 at 12:00 AM UTC";
  if (raw === "@monthly") return "Monthly on day 1 at 12:00 AM UTC";
  if (cronProblem(raw)) return raw ? `Cron: ${raw}` : "No schedule";
  const f = scheduleFromCron(raw, offsetMinutes);
  if (f.frequency === "hourly") return f.minute === 0 ? "Hourly" : `Hourly at :${String(f.minute).padStart(2, "0")}`;
  if (f.frequency === "daily") return `Daily at ${formatTime(f.hour, f.minute)}`;
  if (f.frequency === "weekly") return `Weekly on ${SHORT_DAYS[f.day]} at ${formatTime(f.hour, f.minute)}`;
  const [mi, h, dom, mon, dow] = expandDescriptor(raw).split(/\s+/);
  if (/^\*\/\d+$/.test(mi!) && h === "*" && dom === "*" && mon === "*" && dow === "*") return `Every ${plural(Number(mi!.slice(2)), "minute")}`;
  if (mi === "0" && /^\*\/\d+$/.test(h!) && dom === "*" && mon === "*" && dow === "*") return `Every ${plural(Number(h!.slice(2)), "hour")}`;
  if (/^\d+$/.test(mi!) && /^\d+$/.test(h!) && dom === "*" && mon === "*" && /^[\d,-]+$/.test(dow!)) {
    const days = field(dow!, 0, 7);
    if (days) {
      const list = [...new Set([...days].map((d) => d % 7))].sort();
      const weekdays = list.join(",") === "1,2,3,4,5";
      return `${weekdays ? "Weekdays" : `Weekly on ${list.map((d) => SHORT_DAYS[d]).join(", ")}`} at ${formatTime(Number(h), Number(mi))} UTC`;
    }
  }
  if (/^\d+$/.test(mi!) && /^\d+$/.test(h!) && /^\d+$/.test(dom!) && mon === "*" && dow === "*") return `Monthly on day ${dom} at ${formatTime(Number(h), Number(mi))} UTC`;
  return `Cron: ${raw}`;
}

/** "GMT+2", "GMT-5:30", "GMT" for an offset in minutes. */
export function gmtLabel(offsetMinutes: number): string {
  if (offsetMinutes === 0) return "GMT";
  const sign = offsetMinutes > 0 ? "+" : "-";
  const abs = Math.abs(offsetMinutes);
  return `GMT${sign}${Math.floor(abs / 60)}${abs % 60 ? `:${String(abs % 60).padStart(2, "0")}` : ""}`;
}

/** Local offset (local minus UTC) in minutes for the given date. */
export function localOffset(d: Date = new Date()): number {
  return -d.getTimezoneOffset();
}
