// All schedule dates are plain calendar days ("YYYY-MM-DD").
// They are handled as UTC day numbers so time zones never shift a date.

const DAY_MS = 86_400_000;
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(s: string): boolean {
  if (!ISO_RE.test(s)) return false;
  const d = new Date(s + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Days since 1970-01-01 for a YYYY-MM-DD string. */
export function toDay(iso: string): number {
  return Math.floor(Date.parse(iso + "T00:00:00Z") / DAY_MS);
}

export function fromDay(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

export function dayToDate(day: number): Date {
  return new Date(day * DAY_MS);
}

/** Today's date in the viewer's local time zone, as a day number. */
export function localToday(): number {
  const now = new Date();
  return Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / DAY_MS);
}

/** Inclusive calendar-day duration: Jul 23 -> Aug 14 = 23 days. */
export function durationDays(startIso: string, endIso: string): number {
  if (!isIsoDate(startIso) || !isIsoDate(endIso)) return 0;
  return Math.max(0, toDay(endIso) - toDay(startIso) + 1);
}

export function addDays(iso: string, n: number): string {
  return fromDay(toDay(iso) + n);
}

const fmt = (opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en-US", { timeZone: "UTC", ...opts });

const shortFmt = fmt({ month: "short", day: "numeric" });
const shortYearFmt = fmt({ month: "short", day: "numeric", year: "numeric" });

/** "Jul 23" */
export function formatShort(iso: string): string {
  return isIsoDate(iso) ? shortFmt.format(dayToDate(toDay(iso))) : "—";
}

/** "Jul 23, 2026" */
export function formatShortYear(iso: string): string {
  return isIsoDate(iso) ? shortYearFmt.format(dayToDate(toDay(iso))) : "—";
}

export function formatDuration(days: number): string {
  return `${days} ${days === 1 ? "day" : "days"}`;
}
