import { isIsoDate, toDay } from "./dates";
import { STATUSES, type Project, type ScheduleItem, type Status } from "./types";

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export function newId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

/** Overall schedule range (earliest start, latest end), or null if empty. */
export function scheduleRange(items: ScheduleItem[]): { start: string; end: string } | null {
  const valid = items.filter((i) => isIsoDate(i.startDate) && isIsoDate(i.endDate));
  if (valid.length === 0) return null;
  let start = valid[0].startDate;
  let end = valid[0].endDate;
  for (const i of valid) {
    if (i.startDate < start) start = i.startDate;
    if (i.endDate > end) end = i.endDate;
  }
  return { start, end };
}

/**
 * Validates and cleans untrusted project data (from the admin form).
 * Returns the cleaned project or a list of human-readable errors.
 */
export function validateProject(
  input: unknown,
): { ok: true; project: Omit<Project, "updatedAt" | "slug"> } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const obj = (input ?? {}) as Record<string, unknown>;
  const str = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");

  const propertyAddress = str(obj.propertyAddress);
  const projectName = str(obj.projectName);
  if (!propertyAddress) errors.push("Property address is required.");

  const rawSchedule = Array.isArray(obj.schedule) ? obj.schedule : [];
  const schedule: ScheduleItem[] = rawSchedule.slice(0, 200).map((raw, idx) => {
    const r = (raw ?? {}) as Record<string, unknown>;
    const row = idx + 1;
    const activity = str(r.activity, 120);
    const startDate = str(r.startDate, 10);
    const endDate = str(r.endDate, 10);
    const status = (STATUSES as readonly string[]).includes(r.status as string)
      ? (r.status as Status)
      : "upcoming";

    if (!activity) errors.push(`Row ${row}: activity name is required.`);
    if (!isIsoDate(startDate)) errors.push(`Row ${row}${activity ? ` (${activity})` : ""}: start date is missing.`);
    if (!isIsoDate(endDate)) errors.push(`Row ${row}${activity ? ` (${activity})` : ""}: end date is missing.`);
    if (isIsoDate(startDate) && isIsoDate(endDate) && toDay(endDate) < toDay(startDate)) {
      errors.push(`Row ${row}${activity ? ` (${activity})` : ""}: end date is before start date.`);
    }

    return { id: str(r.id, 40) || `item-${row}`, activity, startDate, endDate, status };
  });

  if (errors.length) return { ok: false, errors };
  return { ok: true, project: { projectName, propertyAddress, schedule } };
}
