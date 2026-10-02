"use server";

import { redirect } from "next/navigation";
import { checkPassword, endSession, isAdmin, startSession } from "@/lib/auth";
import { slugify, validateProject } from "@/lib/project";
import { canWrite, deleteProject, getProject, saveProject } from "@/lib/store";

export type FormState = { error?: string } | undefined;

export async function login(_prev: FormState, formData: FormData): Promise<FormState> {
  if (!process.env.ADMIN_PASSWORD) {
    return { error: "ADMIN_PASSWORD is not configured on the server." };
  }
  if (!checkPassword(String(formData.get("password") ?? ""))) {
    return { error: "Incorrect password." };
  }
  await startSession();
  redirect("/admin");
}

export async function logout(): Promise<void> {
  await endSession();
  redirect("/admin");
}

async function requireAdmin() {
  if (!(await isAdmin())) throw new Error("Not signed in. Refresh the page and sign in again.");
}

export async function createProject(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin();
  const propertyAddress = String(formData.get("propertyAddress") ?? "").trim();
  const projectName = String(formData.get("projectName") ?? "").trim();
  const slug = slugify(String(formData.get("slug") ?? "") || propertyAddress);

  if (!propertyAddress) return { error: "Property address is required." };
  if (!slug) return { error: "Please enter a link name (letters and numbers)." };
  if (slug === "draft") return { error: "Please choose a different link name." };
  if (await getProject(slug)) return { error: `A project with the link “${slug}” already exists.` };

  if (!canWrite()) {
    const q = new URLSearchParams({ slug, address: propertyAddress, name: projectName });
    redirect(`/admin/draft?${q}`);
  }

  await saveProject({
    slug,
    projectName: projectName.slice(0, 200),
    propertyAddress: propertyAddress.slice(0, 200),
    schedule: [],
    updatedAt: new Date().toISOString(),
  });
  redirect(`/admin/${slug}`);
}

export async function removeProject(formData: FormData): Promise<void> {
  await requireAdmin();
  await deleteProject(String(formData.get("slug") ?? ""));
  redirect("/admin");
}

export type SaveResult = { ok: true; updatedAt: string } | { ok: false; errors: string[] };

export async function saveSchedule(slug: string, data: unknown): Promise<SaveResult> {
  if (!(await isAdmin())) return { ok: false, errors: ["Your login has expired. Refresh the page and sign in again."] };
  if (!canWrite()) return { ok: false, errors: ["Use “Publish on GitHub” to save changes."] };
  if (!(await getProject(slug))) return { ok: false, errors: ["This project no longer exists."] };

  const result = validateProject(data);
  if (!result.ok) return result;

  const updatedAt = new Date().toISOString();
  try {
    await saveProject({ slug, ...result.project, updatedAt });
  } catch (e) {
    return { ok: false, errors: [e instanceof Error ? e.message : "Save failed."] };
  }
  return { ok: true, updatedAt };
}
