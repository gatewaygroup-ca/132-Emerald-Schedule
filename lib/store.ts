import "server-only";
import { promises as fs } from "fs";
import path from "path";
import bundled from "@/data/projects.json";
import type { Project } from "./types";

/*
 * Project storage: a single JSON file, data/projects.json. No database.
 *
 * - Local development: the file is read and written directly on disk.
 * - On Vercel (read-only disk): set GITHUB_TOKEN and the app reads and commits
 *   data/projects.json in this GitHub repo through the GitHub API. Every save is a
 *   commit, so you get a full change history.
 */

const DATA_PATH = "data/projects.json";
const LOCAL_FILE = path.join(process.cwd(), DATA_PATH);

const GH_TOKEN = process.env.GITHUB_TOKEN;
const GH_REPO =
  process.env.GITHUB_REPO ||
  (process.env.VERCEL_GIT_REPO_OWNER && process.env.VERCEL_GIT_REPO_SLUG
    ? `${process.env.VERCEL_GIT_REPO_OWNER}/${process.env.VERCEL_GIT_REPO_SLUG}`
    : "");
const GH_BRANCH = process.env.GITHUB_BRANCH || process.env.VERCEL_GIT_COMMIT_REF || "main";
const GH_API = (process.env.GITHUB_API_URL || "https://api.github.com").replace(/\/+$/, "");
const useGitHub = Boolean(GH_TOKEN && GH_REPO);

export function storageMode(): "github" | "local" | "publish" {
  if (useGitHub) return "github";
  // On Vercel without a token the disk is read-only: changes are published by
  // committing data/projects.json on github.com (the editor walks you through it).
  return process.env.VERCEL ? "publish" : "local";
}

/** Can the server save changes itself? If not, the editor uses "Publish on GitHub". */
export function canWrite(): boolean {
  return storageMode() !== "publish";
}

/** github.com page for editing the data file in the browser. */
export function githubEditUrl(): string {
  const repo = GH_REPO || "gatewaygroup-ca/132-Emerald-Schedule";
  const branch = process.env.GITHUB_BRANCH || "main";
  return `https://github.com/${repo}/edit/${branch}/${DATA_PATH}`;
}

/* ---------------- GitHub (contents API, no extra dependency) ---------------- */

const ghUrl = () => `${GH_API}/repos/${GH_REPO}/contents/${DATA_PATH}`;

async function gh(url: string, init: RequestInit = {}): Promise<Response> {
  return fetch(url, {
    ...init,
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${GH_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "project-schedule",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
  });
}

async function ghRead(): Promise<{ projects: Project[]; sha: string | null }> {
  const res = await gh(`${ghUrl()}?ref=${encodeURIComponent(GH_BRANCH)}`);
  if (res.status === 404) return { projects: bundled as Project[], sha: null };
  if (!res.ok) throw new Error(`GitHub read failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  const body = (await res.json()) as { content: string; sha: string };
  const json = Buffer.from(body.content, "base64").toString("utf8");
  return { projects: JSON.parse(json) as Project[], sha: body.sha };
}

async function ghUpdate(change: (all: Project[]) => Project[], message: string): Promise<void> {
  // Retry once if someone else saved in between (sha conflict).
  for (let attempt = 0; attempt < 2; attempt++) {
    const { projects, sha } = await ghRead();
    const content = Buffer.from(serialize(change(projects)), "utf8").toString("base64");
    const res = await gh(ghUrl(), {
      method: "PUT",
      body: JSON.stringify({ message, content, branch: GH_BRANCH, ...(sha ? { sha } : {}) }),
    });
    if (res.ok) return;
    if ((res.status === 409 || res.status === 422) && attempt === 0) continue;
    throw new Error(`GitHub save failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  }
}

/* ---------------- Local file ---------------- */

function serialize(projects: Project[]): string {
  return JSON.stringify(projects, null, 2) + "\n";
}

async function localRead(): Promise<Project[]> {
  try {
    return JSON.parse(await fs.readFile(LOCAL_FILE, "utf8")) as Project[];
  } catch {
    return bundled as Project[];
  }
}

async function localUpdate(change: (all: Project[]) => Project[]): Promise<void> {
  if (process.env.VERCEL) {
    throw new Error("Saving is not configured. Add a GITHUB_TOKEN environment variable in Vercel (see SETUP.md).");
  }
  await fs.writeFile(LOCAL_FILE, serialize(change(await localRead())), "utf8");
}

/* ---------------- Public API ---------------- */

async function readAll(): Promise<Project[]> {
  return useGitHub ? (await ghRead()).projects : localRead();
}

async function update(change: (all: Project[]) => Project[], message: string): Promise<void> {
  return useGitHub ? ghUpdate(change, message) : localUpdate(change);
}

export async function listProjects(): Promise<Project[]> {
  return [...(await readAll())].sort((a, b) => a.propertyAddress.localeCompare(b.propertyAddress));
}

export async function getProject(slug: string): Promise<Project | null> {
  return (await readAll()).find((p) => p.slug === slug) ?? null;
}

export async function saveProject(project: Project): Promise<void> {
  await update((all) => {
    const idx = all.findIndex((p) => p.slug === project.slug);
    return idx >= 0 ? all.map((p, i) => (i === idx ? project : p)) : [...all, project];
  }, `Update schedule: ${project.slug}`);
}

export async function deleteProject(slug: string): Promise<void> {
  await update((all) => all.filter((p) => p.slug !== slug), `Delete schedule: ${slug}`);
}
