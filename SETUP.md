# Project Schedule (Next.js)

A simple, client-facing construction schedule with a Gantt chart and a password-protected editor.

- **Client page (public, read-only):** `/project/<link>`, for example `/project/138-paling`
- **Admin (password):** `/admin`. Lists projects, creates new ones, and opens the editor at `/admin/<link>`

> The old Firebase template files (`index.html`, `script.js`, `style.css`, `data.js`, `firebase-*`, `gitignore`, `README.md`)
> are not used by this app. Delete them whenever you are ready.

## Run locally

```bash
npm install
cp .env.example .env.local   # then set ADMIN_PASSWORD
npm run dev                  # http://localhost:3000/project/138-paling
```

Without Supabase settings, local edits are saved to `data/projects.local.json` (git-ignored).
The starting data comes from `data/seed.json`.

## Deploy (GitHub + Vercel + Supabase)

1. **Supabase:** create a free project. Go to **SQL Editor**, paste in `supabase/schema.sql`, and click **Run**.
   Then go to **Project Settings → API** and copy the **Project URL** and the **service_role** key (or a **secret** key).
2. **Vercel:** go to **Add New → Project**, import this GitHub repo (Next.js is detected automatically), and add these environment variables:

   | Variable | Value |
   |---|---|
   | `ADMIN_PASSWORD` | your admin password |
   | `SESSION_SECRET` | a long random string (`openssl rand -hex 32`) |
   | `SUPABASE_URL` | `https://xxxx.supabase.co` |
   | `SUPABASE_SERVICE_ROLE_KEY` | the service_role / secret key |

3. Deploy. On first load, the empty Supabase table is filled with `data/seed.json` (138 Paling Road).

The Supabase key is used only on the server and never sent to the browser. Row-level security is on with no
public policies, so the database cannot be read or written directly from outside.

## Adding another project

Go to `/admin` → **New project**, enter the address and an optional link name (e.g. `52-king`), then send the client
`https://<your-site>/project/52-king`.

## Data shape

Each project is stored as one JSON document (one row in the `projects` table):

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
lib/store.ts                  storage (Supabase REST or local JSON file)
lib/auth.ts                   password login, signed cookie
lib/dates.ts, lib/project.ts  date math, validation
```
