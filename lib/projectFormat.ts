import type { Project } from "./types";

/** Timestamped file name, e.g. "20261002T190431Z.json". Newest sorts last. */
export function versionFileName(date = new Date()): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z") + ".json";
}

/** Writes JSON with one schedule item per line (compact and readable on GitHub). */
export function serializeProject(project: Project): string {
  const { schedule, ...rest } = project;
  const head = JSON.stringify(rest, null, 2).slice(0, -2);
  const items = schedule.map((i) => "    " + JSON.stringify(i)).join(",\n");
  return `${head},\n  "schedule": [\n${items}${items ? "\n" : ""}  ]\n}\n`;
}
