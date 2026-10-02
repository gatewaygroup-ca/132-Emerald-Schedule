# Project Schedule (Next.js)

A simple, client-facing construction schedule with a Gantt chart and a password-protected editor.

- **Client page (public, read-only):** `/project/<link>`, for example `/project/138-paling`
- **Admin (password):** `/admin`. Lists projects, creates new ones, and opens the editor at `/admin/<link>`

## How data is saved (no database)

Each project is a folder of JSON files in this repo: **`data/projects/<link>/<timestamp>.json`**.
The newest file is the current schedule; older files are kept as history.

**Updating a schedule on the live site:**
1. Open `/admin`, click **Edit schedule** (or create a **New project**), and make your changes.
2. Click **Publish on GitHub**. GitHub opens with the new schedule file already filled in.
3. Click **Commit changes…**, then **Commit changes**. Vercel redeploys; the client page updates in about a minute.

Only people who can sign in to GitHub with write access to this repo can publish. Nothing changes until you commit.
To remove a project, delete its folder in `data/projects` on GitHub.

No Supabase, Firebase, or other external database is used.

## Run locally

```bash
npm install
cp .env.example .env.local   # then set ADMIN_PASSWORD (local saving writes data/projects directly)
npm run dev                  # http://localhost:3000/project/138-paling
```

## Deploy

The repo is connected to Vercel. Every push to `main` deploys. `vercel.json` sets the framework to Next.js.

## Adding another project

Go to `/admin` → **New project**, enter the address and an optional link name (e.g. `52-king`), add activities and
publish, then send the client
`https://<your-site>/project/52-king`.

## Data shape

Each file in `data/projects/<link>/` holds one project:

```json
{
  "slug": "138-paling",
  "projectName": "",
  "propertyAddress": "138 Paling Road, Hamilton, ON",
  "updatedAt": "2026-10-02T12:00:00.000Z",
  "schedule": [
    { "id": "a3", "activity": "Framing", "startDate": "2026-07-23", "endDate": "2026-08-14", "status": "complete" }
  ]
}
```

`status` is one of `complete`, `in-progress`, `upcoming`, `delayed`. Duration is counted in calendar days, including
both the start and end day (Jul 23 → Aug 14 = 23 days).

## Code map

```
app/project/[slug]/page.tsx   client schedule page
app/admin/page.tsx            login + project list + new project
app/admin/[slug]/page.tsx     schedule editor
app/admin/actions.ts          server actions (login, save, create, delete)
components/Gantt.tsx          Gantt chart + legend
components/ScheduleView.tsx   client-facing layout (also used as the admin live preview)
components/admin/             editor + admin forms
lib/store.ts                  storage (data/projects/<link>/*.json)
scripts/build-data.mjs        bundles the newest schedule of each project before every build
lib/auth.ts                   password login, signed cookie
lib/dates.ts, lib/project.ts  date math, validation
```
