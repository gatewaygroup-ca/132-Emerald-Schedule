# Project Schedule (Next.js)

A simple, client-facing construction schedule with a Gantt chart and a password-protected editor.

- **Client page (public, read-only):** `/project/<link>`, for example `/project/138-paling`
- **Admin (password):** `/admin`. Lists projects, creates new ones, and opens the editor at `/admin/<link>`

## How data is saved (no database)

All schedules live in one file in this repo: **`data/projects.json`**.

- **Locally:** saving in the admin editor writes that file directly.
- **On Vercel:** the server can't write files, so each save is committed to `data/projects.json` in this
  GitHub repo through the GitHub API. Every change is in the repo's commit history.
  `vercel.json` skips rebuilding when only this file changed, so saves don't trigger deploys.

No Supabase, Firebase, or other external database is used.

## Run locally

```bash
npm install
cp .env.example .env.local   # then set ADMIN_PASSWORD
npm run dev                  # http://localhost:3000/project/138-paling
```

## Deploy (GitHub + Vercel)

1. **GitHub token:** go to GitHub → Settings → Developer settings → **Fine-grained tokens** → Generate new token.
   For **Repository access**, choose *Only select repositories* and pick this repo.
   Under **Permissions**, set **Contents** to *Read and write*. Copy the token.
2. **Vercel:** go to **Add New → Project** and import this repo (Next.js is detected automatically). Add these environment variables:

   | Variable | Value |
   |---|---|
   | `ADMIN_PASSWORD` | your admin password |
   | `SESSION_SECRET` | a long random string (`openssl rand -hex 32`) |
   | `GITHUB_TOKEN` | the token from step 1 |
   | `GITHUB_BRANCH` | `main` (the branch Vercel deploys) |

   `GITHUB_REPO` is detected automatically on Vercel.
3. Deploy, then open `https://<your-site>/project/138-paling`.

The token is used only on the server and never reaches the browser.

## Adding another project

Go to `/admin` → **New project**, enter the address and an optional link name (e.g. `52-king`), then send the client
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
