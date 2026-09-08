/**
 * One way to say when something is.
 *
 *   formatWhen(due)   -> "Today" | "Tomorrow" | "Yesterday" | "Mon 15 Sep" | "15 Sep 2025"
 *   formatWhen(due, { overdue: true }) -> "3 days overdue" for past dates
 *   formatAgo(created) -> "just now" | "5m ago" | "2h ago" | "3d ago" | "Mon 15 Sep"
 *
 * Every page used to carry its own copy of these with slightly different
 * output. They all read the user's timezone from the same setting.
 */

function tz(): string {
  try {
    return localStorage.getItem("pmi-timezone") ?? "UTC";
  } catch {
    return "UTC";
  }
}

/** Calendar day of `d` in the user's timezone as a YYYY-MM-DD string. */
function dayKey(d: Date, timezone: string): string {
  return d.toLocaleDateString("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" });
}

function dayDiff(a: Date, b: Date, timezone: string): number {
  const ka = dayKey(a, timezone);
  const kb = dayKey(b, timezone);
  return Math.round((Date.parse(ka) - Date.parse(kb)) / 86_400_000);
}

function toDate(v: string | Date): Date {
  if (v instanceof Date) return v;
  // A bare date ("2026-09-15") is a calendar day, not midnight UTC.
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T12:00:00`) : new Date(v);
}

export interface FormatWhenOptions {
  /** Past dates read "3 days overdue" instead of "Yesterday" / a date. */
  overdue?: boolean;
  /** Append the clock time for datetimes ("Today 3:30 PM"). */
  time?: boolean;
}

export function formatWhen(value: string | Date | null | undefined, opts: FormatWhenOptions = {}): string {
  if (!value) return "";
  const timezone = tz();
  const d = toDate(value);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const diff = dayDiff(d, now, timezone);

  let day: string;
  if (opts.overdue && diff < 0) {
    day = diff === -1 ? "1 day overdue" : `${-diff} days overdue`;
  } else if (diff === 0) day = "Today";
  else if (diff === 1) day = "Tomorrow";
  else if (diff === -1) day = "Yesterday";
  else if (Math.abs(diff) < 180) {
    day = d.toLocaleDateString("en-US", { timeZone: timezone, weekday: "short", day: "numeric", month: "short" });
  } else {
    day = d.toLocaleDateString("en-US", { timeZone: timezone, day: "numeric", month: "short", year: "numeric" });
  }

  const hasClock = value instanceof Date || value.includes("T");
  if (opts.time && hasClock && !(opts.overdue && diff < 0)) {
    return `${day} ${d.toLocaleTimeString("en-US", { timeZone: timezone, hour: "numeric", minute: "2-digit" })}`;
  }
  return day;
}

/** "just now", "5m ago", "2h ago", "3d ago"; older than a week falls back to the date. */
export function formatAgo(value: string | Date | null | undefined): string {
  if (!value) return "";
  const d = toDate(value);
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 45) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}d ago`;
  return formatWhen(d);
}
