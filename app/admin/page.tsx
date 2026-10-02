import type { Metadata } from "next";
import Link from "next/link";
import { DeleteProjectButton, LoginForm, NewProjectForm } from "@/components/admin/forms";
import { isAdmin, loginRequired } from "@/lib/auth";
import { canWrite, listProjects, storageMode } from "@/lib/store";
import { logout } from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Admin – Project Schedules" };

export default async function AdminPage() {
  if (!(await isAdmin())) {
    return (
      <main className="mx-auto max-w-sm px-4 py-24">
        <h1 className="mb-6 text-xl font-semibold text-slate-900">Schedule admin</h1>
        <LoginForm />
      </main>
    );
  }

  const projects = await listProjects();

  return (
    <main className="mx-auto max-w-4xl px-4 py-10 sm:px-8">
      <div className="flex items-center justify-between border-b border-slate-200 pb-4">
        <h1 className="text-xl font-semibold text-slate-900">Project schedules</h1>
        {loginRequired() && (
          <form action={logout}>
            <button className="text-sm text-slate-500 hover:text-slate-900">Sign out</button>
          </form>
        )}
      </div>

      {storageMode() === "local" && (
        <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Local mode: changes are saved to <code>data/projects.json</code> on this computer.
        </p>
      )}
      {storageMode() === "publish" && (
        <p className="mt-4 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
          Edit a schedule, then click <strong>Publish on GitHub</strong>. You&apos;ll paste the update into GitHub and
          commit it; the live site updates about a minute later.
        </p>
      )}

      <ul className="mt-2 divide-y divide-slate-100">
        {projects.map((p) => (
          <li key={p.slug} className="flex flex-col gap-2 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="font-medium text-slate-900">{p.propertyAddress}</div>
              <div className="text-sm text-slate-500">
                {p.projectName ? `${p.projectName} · ` : ""}
                {p.schedule.length} {p.schedule.length === 1 ? "activity" : "activities"} · /project/{p.slug}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-5">
              <Link href={`/project/${p.slug}`} className="text-sm text-slate-600 hover:text-slate-900" target="_blank">
                Client view ↗
              </Link>
              <Link
                href={`/admin/${p.slug}`}
                className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700"
              >
                Edit schedule
              </Link>
              {canWrite() && <DeleteProjectButton slug={p.slug} address={p.propertyAddress} />}
            </div>
          </li>
        ))}
        {projects.length === 0 && <li className="py-6 text-sm text-slate-500">No projects yet.</li>}
      </ul>

      <section className="mt-12 border-t border-slate-200 pt-8">
        <h2 className="mb-4 text-base font-semibold text-slate-900">New project</h2>
        <NewProjectForm />
      </section>
    </main>
  );
}
