import "server-only";
import { promises as fs } from "fs";
import path from "path";
import bundled from "./projects.generated.json";
import { PROJECTS_DIR, readProjectsDir } from "./projectFiles.mjs";
import { serializeProject, versionFileName } from "./projectFormat";
import type { Project } from "./types";

/*
 * Project storage: plain JSON files in this repo. No database.
 *
 *   data/projects/<link>/<timestamp>.json   (newest file = current schedule)
 *
 * - Local development: the admin editor writes new files directly.
 * - Live site (Vercel): the disk is read-only, so "Publish on GitHub" opens GitHub
 *   with the new file already filled in. Committing it redeploys the site.
 */

const REPO = process.env.GITHUB_REPO ||
  (process.env.VERCEL_GIT_REPO_OWNER && process.env.VERCEL_GIT_REPO_SLUG
    ? `${process.env.VERCEL_GIT_REPO_OWNER}/${process.env.VERCEL_GIT_REPO_SLUG}`
    : "gatewaygroup-ca/132-Emerald-Schedule");
const BRANCH = process.env.GITHUB_BRANCH || "main";

/** Can the server save changes itself? (Not on Vercel: changes are published via GitHub.) */
export function canWrite(): boolean {
  return !process.env.VERCEL;
}

/** github.com "new file" page; the editor adds ?filename=…&value=… */
export function githubNewFileUrl(): string {
  return `https://github.com/${REPO}/new/${BRANCH}`;
}

async function readAll(): Promise<Project[]> {
  // Live site: the copy bundled at build time. Local dev: the files on disk.
  if (process.env.VERCEL) return bundled as Project[];
  return ((await readProjectsDir()) as Project[] | null) ?? (bundled as Project[]);
}

export async function listProjects(): Promise<Project[]> {
  return [...(await readAll())].sort((a, b) => a.propertyAddress.localeCompare(b.propertyAddress));
}

export async function getProject(slug: string): Promise<Project | null> {
  return (await readAll()).find((p) => p.slug === slug) ?? null;
}

export async function saveProject(project: Project): Promise<void> {
  if (!canWrite()) throw new Error("Use “Publish on GitHub” to save changes.");
  const dir = path.join(PROJECTS_DIR, project.slug);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, versionFileName(new Date(project.updatedAt))), serializeProject(project), "utf8");
}

export async function deleteProject(slug: string): Promise<void> {
  if (!canWrite()) throw new Error("Delete the project's folder in data/projects on GitHub.");
  if (!/^[a-z0-9-]+$/.test(slug)) return;
  await fs.rm(path.join(PROJECTS_DIR, slug), { recursive: true, force: true });
}
