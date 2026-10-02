// Shared by the app (lib/store.ts) and the build script (scripts/build-data.mjs).
//
// Each project lives in its own folder: data/projects/<link>/<timestamp>.json
// Every publish adds a new file; the newest valid file (by name) is the current schedule.
// Older files are kept as history. A broken or wrongly-shaped file is skipped (with a
// warning) and the previous file is used, so one bad edit never takes the site down.
import { promises as fs } from "fs";
import path from "path";

export const PROJECTS_DIR = path.join(process.cwd(), "data", "projects");

/** Returns a clean project from parsed file content, or null if it isn't usable. */
export function toProject(data, slug) {
  // Accept a list (old format) by picking this project's entry.
  if (Array.isArray(data)) data = data.find((p) => p && p.slug === slug) ?? (data.length === 1 ? data[0] : null);
  if (!data || typeof data !== "object") return null;
  if (data.deleted) return { deleted: true };
  if (typeof data.propertyAddress !== "string" || !Array.isArray(data.schedule)) return null;
  const schedule = data.schedule.filter(
    (i) => i && typeof i.activity === "string" && typeof i.startDate === "string" && typeof i.endDate === "string",
  );
  return {
    slug,
    projectName: typeof data.projectName === "string" ? data.projectName : "",
    propertyAddress: data.propertyAddress,
    updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : "",
    schedule: schedule.map((i, n) => ({
      id: String(i.id || `item-${n + 1}`),
      activity: i.activity,
      startDate: i.startDate,
      endDate: i.endDate,
      status: ["complete", "in-progress", "upcoming", "delayed"].includes(i.status) ? i.status : "upcoming",
    })),
  };
}

/** Reads the newest valid file of every project folder. Returns null if the folder is missing. */
export async function readProjectsDir(dir = PROJECTS_DIR) {
  let slugs;
  try {
    slugs = (await fs.readdir(dir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return null;
  }
  const projects = [];
  for (const slug of slugs) {
    const files = (await fs.readdir(path.join(dir, slug))).filter((f) => f.endsWith(".json")).sort().reverse();
    for (const file of files) {
      let project = null;
      try {
        project = toProject(JSON.parse(await fs.readFile(path.join(dir, slug, file), "utf8")), slug);
      } catch {}
      if (!project) {
        console.warn(`Skipping unusable schedule file data/projects/${slug}/${file}`);
        continue;
      }
      if (!project.deleted) projects.push(project);
      break;
    }
  }
  return projects;
}
