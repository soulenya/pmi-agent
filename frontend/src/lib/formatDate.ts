/**
 * Date/time formatting utilities that respect the user's timezone setting.
 * All functions accept an IANA timezone string (e.g. "America/New_York").
 */

/** Format a date as "Jun 6, 2026" (short month, day, year). */
export function formatDate(
  iso: string | Date,
  timezone: string,
  options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" },
): string {
  const date = typeof iso === "string" ? new Date(iso) : iso;
  return date.toLocaleDateString("en-US", { timeZone: timezone, ...options });
}

/** Format a time as "09:30 AM". */
export function formatTime(
  iso: string | Date,
  timezone: string,
  options: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit" },
): string {
  const date = typeof iso === "string" ? new Date(iso) : iso;
  return date.toLocaleTimeString("en-US", { timeZone: timezone, ...options });
}

/** Format a date + time as "Jun 6, 2026, 09:30 AM". */
export function formatDateTime(
  iso: string | Date,
  timezone: string,
): string {
  const date = typeof iso === "string" ? new Date(iso) : iso;
  return date.toLocaleString("en-US", {
    timeZone: timezone,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
