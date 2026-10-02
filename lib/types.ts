export const STATUSES = ["complete", "in-progress", "upcoming", "delayed"] as const;
export type Status = (typeof STATUSES)[number];

export const STATUS_LABELS: Record<Status, string> = {
  complete: "Complete",
  "in-progress": "In Progress",
  upcoming: "Upcoming",
  delayed: "Delayed",
};

export interface ScheduleItem {
  id: string;
  activity: string;
  /** YYYY-MM-DD */
  startDate: string;
  /** YYYY-MM-DD, inclusive */
  endDate: string;
  status: Status;
}

export interface Project {
  /** URL id, e.g. "138-paling" -> /project/138-paling */
  slug: string;
  projectName: string;
  propertyAddress: string;
  schedule: ScheduleItem[];
  /** ISO timestamp, set on every save */
  updatedAt: string;
}
