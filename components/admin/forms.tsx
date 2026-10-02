"use client";

import { useActionState } from "react";
import { createProject, login, removeProject } from "@/app/admin/actions";

const input =
  "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-200";
const primaryBtn =
  "rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50";

export function LoginForm() {
  const [state, action, pending] = useActionState(login, undefined);
  return (
    <form action={action} className="space-y-4">
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-slate-700">Admin password</span>
        <input type="password" name="password" autoComplete="current-password" required autoFocus className={input} />
      </label>
      {state?.error && <p className="text-sm text-red-700">{state.error}</p>}
      <button type="submit" disabled={pending} className={primaryBtn}>
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}

export function NewProjectForm() {
  const [state, action, pending] = useActionState(createProject, undefined);
  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2">
      <label className="block sm:col-span-2">
        <span className="mb-1 block text-sm font-medium text-slate-700">Property address</span>
        <input name="propertyAddress" required placeholder="138 Paling Road, Hamilton, ON" className={input} />
      </label>
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-slate-700">
          Project name <span className="font-normal text-slate-400">(optional)</span>
        </span>
        <input name="projectName" className={input} />
      </label>
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-slate-700">
          Link name <span className="font-normal text-slate-400">(optional)</span>
        </span>
        <div className="flex items-center gap-1 text-sm text-slate-500">
          <span>/project/</span>
          <input name="slug" placeholder="138-paling" pattern="[A-Za-z0-9\-]*" className={input} />
        </div>
      </label>
      {state?.error && <p className="text-sm text-red-700 sm:col-span-2">{state.error}</p>}
      <div className="sm:col-span-2">
        <button type="submit" disabled={pending} className={primaryBtn}>
          {pending ? "Creating…" : "Create project"}
        </button>
      </div>
    </form>
  );
}

export function DeleteProjectButton({ slug, address }: { slug: string; address: string }) {
  return (
    <form
      action={removeProject}
      onSubmit={(e) => {
        if (!confirm(`Delete the schedule for ${address}? This cannot be undone.`)) e.preventDefault();
      }}
    >
      <input type="hidden" name="slug" value={slug} />
      <button type="submit" className="text-sm text-slate-500 hover:text-red-700">
        Delete
      </button>
    </form>
  );
}
