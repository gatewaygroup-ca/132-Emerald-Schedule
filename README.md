# Project Schedule (Next.js)

A simple, client-facing construction schedule with a Gantt chart and a password-protected editor.

- **Client page (public, read-only):** `/project/<link>`, for example `/project/138-paling`
- **Admin (password):** `/admin`. Lists projects, creates new ones, and opens the editor at `/admin/<link>`

## How data is saved (no database)

All schedules live in one file in this repo: **`data/projects.json`**.

- **Live site (default, no setup):** open `/admin`, pick a project, and edit it. Click **Publish on GitHub**:
  the update is copied for you. Open the file on GitHub, select all, paste, and click **Commit changes**.
  Vercel redeploys automatically and the client page updates in about a minute.
  Only people with write access to this GitHub repo can publish.
- **Locally:** `npm run dev` with `ADMIN_PASSWORD` set; saving writes `data/projects.json` directly.
- **Optional one-click saving on Vercel:** add `ADMIN_PASSWORD`, `SESSION_SECRET` and a `GITHUB_TOKEN`
  (fine-grained token, this repo only, Contents: Read and write; create one at
  https://github.com/settings/personal-access-tokens/new). The Save button then commits to GitHub for you,
  and `/admin` asks for the password.

No Supabase, Firebase, or other external database is used.

## Run locally

```bash
npm install
cp .env.example .env.local   # then set ADMIN_PASSWORD
npm run dev                  # http://localhost:3000/project/138-paling
```

## Deploy

The repo is connected to Vercel. Every push to `main` deploys. `vercel.json` sets the framework to Next.js.

## Adding another project

Go to `/admin` → **New project**, enter the address and an optional link name (e.g. `52-king`), add activities and
publish, then send the client
`https://<your-site>/project/52-king`.

## Data shape

`data/projects.json` is a list of projects:

```json
[{
  "slug": "138-paling",
  "projectName": "",
  "propertyAddress": "138 Paling Road, Hamilton, ON",
  "updatedAt": "2026-10-02T12:00:00.000Z",
  "schedule": [
    { "id": "a3", "activity": "Framing", "startDate": "2026-07-23", "endDate": "2026-08-14", "status": "complete" }
  ]
}]
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
lib/store.ts                  storage (data/projects.json: on disk, or via the GitHub API)
lib/auth.ts                   password login, signed cookie
lib/dates.ts, lib/project.ts  date math, validation
```
