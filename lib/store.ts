import "server-only";
import { promises as fs } from "fs";
import path from "path";
import seed from "@/data/seed.json";
import type { Project } from "./types";

/*
 * Project storage.
 *
 * - If SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set, projects are stored
 *   in the Supabase `projects` table (see supabase/schema.sql). Use this on Vercel.
 * - Otherwise (local development), projects are stored in data/projects.local.json.
 *
 * The first time storage is empty, it is filled with data/seed.json.
 */

const SUPABASE_URL = process.env.SUPABASE_URL?.replace(/\/+$/, "");
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const useSupabase = Boolean(SUPABASE_URL && SUPABASE_KEY);

const LOCAL_FILE = path.join(process.cwd(), "data", "projects.local.json");

const seedProjects = seed as Project[];

export function storageMode(): "supabase" | "local" {
  return useSupabase ? "supabase" : "local";
}

/* ---------------- Supabase (REST, no extra dependency) ---------------- */

async function sb(pathAndQuery: string, init: RequestInit = {}): Promise<Response> {
  const headers: Record<string, string> = {
    apikey: SUPABASE_KEY!,
    "Content-Type": "application/json",
    ...(init.headers as Record<string, string>),
  };
  // Legacy service_role keys are JWTs and also go in the Authorization header.
  if (SUPABASE_KEY!.startsWith("eyJ")) headers.Authorization = `Bearer ${SUPABASE_KEY}`;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    ...init,
    headers,
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Supabase request failed (${res.status}): ${body.slice(0, 300)}`);
  }
  return res;
}

async function sbList(): Promise<Project[]> {
  const res = await sb("projects?select=data&order=slug.asc");
  const rows = (await res.json()) as { data: Project }[];
  if (rows.length === 0) {
    for (const p of seedProjects) await sbUpsert(p);
    return seedProjects;
  }
  return rows.map((r) => r.data);
}

async function sbGet(slug: string): Promise<Project | null> {
  const res = await sb(`projects?select=data&slug=eq.${encodeURIComponent(slug)}`);
  const rows = (await res.json()) as { data: Project }[];
  if (rows.length) return rows[0].data;
  // Bootstrap an empty table with the seed data.
  const all = await sbList();
  return all.find((p) => p.slug === slug) ?? null;
}

async function sbUpsert(project: Project): Promise<void> {
  await sb("projects?on_conflict=slug", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ slug: project.slug, data: project, updated_at: project.updatedAt }),
  });
}

async function sbDelete(slug: string): Promise<void> {
  await sb(`projects?slug=eq.${encodeURIComponent(slug)}`, { method: "DELETE" });
}

/* ---------------- Local JSON file ---------------- */

async function localReadAll(): Promise<Project[]> {
  try {
    return JSON.parse(await fs.readFile(LOCAL_FILE, "utf8")) as Project[];
  } catch {
    return seedProjects;
  }
}

async function localWriteAll(projects: Project[]): Promise<void> {
  if (process.env.VERCEL) {
    throw new Error(
      "Saving is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in your Vercel project settings.",
    );
  }
  await fs.writeFile(LOCAL_FILE, JSON.stringify(projects, null, 2) + "\n", "utf8");
}

/* ---------------- Public API ---------------- */

export async function listProjects(): Promise<Project[]> {
  const all = useSupabase ? await sbList() : await localReadAll();
  return [...all].sort((a, b) => a.propertyAddress.localeCompare(b.propertyAddress));
}

export async function getProject(slug: string): Promise<Project | null> {
  if (useSupabase) return sbGet(slug);
  return (await localReadAll()).find((p) => p.slug === slug) ?? null;
}

export async function saveProject(project: Project): Promise<void> {
  if (useSupabase) return sbUpsert(project);
  const all = await localReadAll();
  const idx = all.findIndex((p) => p.slug === project.slug);
  if (idx >= 0) all[idx] = project;
  else all.push(project);
  await localWriteAll(all);
}

export async function deleteProject(slug: string): Promise<void> {
  if (useSupabase) return sbDelete(slug);
  await localWriteAll((await localReadAll()).filter((p) => p.slug !== slug));
}
