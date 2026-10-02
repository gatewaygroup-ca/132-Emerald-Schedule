// Shared by the app (lib/store.ts) and the build script (scripts/build-data.mjs).
//
// Each project lives in its own folder: data/projects/<link>/<timestamp>.json
// Every publish adds a new file; the newest file (by name) is the current schedule.
// Older files are kept as history.
import { promises as fs } from "fs";
import path from "path";

export const PROJECTS_DIR = path.join(process.cwd(), "data", "projects");

/** Reads the newest file of every project folder. Returns [] if the folder is missing. */
export async function readProjectsDir(dir = PROJECTS_DIR) {
  let slugs;
  try {
    slugs = (await fs.readdir(dir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return null;
  }
  const projects = [];
  for (const slug of slugs) {
    const files = (await fs.readdir(path.join(dir, slug))).filter((f) => f.endsWith(".json")).sort();
    const latest = files.at(-1);
    if (!latest) continue;
    try {
      const data = JSON.parse(await fs.readFile(path.join(dir, slug, latest), "utf8"));
      if (data && !data.deleted) projects.push({ ...data, slug });
    } catch (e) {
      console.error(`Skipping unreadable schedule file ${slug}/${latest}:`, e.message);
    }
  }
  return projects;
}
