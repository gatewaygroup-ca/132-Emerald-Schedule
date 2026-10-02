# 132 Emerald — Live Project Schedule

A live construction schedule you can share with clients. It runs on
**GitHub + Vercel only** — no database or other service.

- **Clients** open the site link. They see a clean, read-only schedule
  (timeline, progress, what's happening now / next, full milestone list).
  Open screens update by themselves within about a minute of any change —
  no refresh needed.
- **You (admin)** click **Admin**, log in once with a GitHub access token,
  and can import, add, edit, reorder and delete milestones. Every change
  saves automatically to GitHub; Vercel redeploys and clients see it.

## How it works

```
Admin edits on the website
   └─► saved to schedule.json in this GitHub repo (main branch)
          └─► Vercel redeploys automatically (~30–60 s)
                 └─► client screens re-check every 30 s and update
```

Only people with a GitHub token that can write to this repo can change
the schedule — GitHub enforces that, not the web page.

## One-time admin setup (2 minutes)

1. Go to **GitHub → Settings → Developer settings → Fine-grained tokens →
   Generate new token** (https://github.com/settings/personal-access-tokens/new).
2. **Resource owner:** `gatewaygroup-ca`.
   **Repository access:** *Only select repositories* → `132-Emerald-Schedule`.
3. **Permissions → Repository permissions → Contents:** *Read and write*.
4. Pick an expiry, click **Generate token**, and copy it.
5. On the live site click **Admin** and paste the token.

The token is stored only in that browser. Use **Log out** on shared
computers. When it expires, make a new one the same way.

## Importing a schedule

**Admin → Import Schedule**

- Accepts **Excel (.xlsx/.xls)**, **CSV**, an **MS Project** export saved
  as Excel/CSV, or rows **pasted** from Excel / Google Sheets.
- Columns are detected automatically (Task Name, Start, Finish, Duration,
  Predecessors, % Complete, Status, Trade / Resource Names, Notes) and every
  mapping can be changed. *Download a blank template* gives a ready CSV.
- A preview shows exactly what will be saved. Choose **Replace** (swap in
  the new schedule) or **Add** (append).
- Dates from the file are kept exactly. Durations are working days
  (Mon–Fri, minus holidays set in **Project Details & Holidays**).

## Admin tools

- **+ Add Milestone / Edit** — name, trade, start date or "starts after"
  another milestone, duration, status, progress, notes (notes are visible
  to clients).
- **↑ ↓** — reorder milestones.
- **Project Details & Holidays** — name, address, client, project manager,
  start and target dates, a description for clients, and non-working days.
- **View as client** — see exactly what clients see.
- **Export CSV** — download the schedule (re-importable).
- The top bar shows **Saving… / Saved ✓**. If a save fails (e.g. no
  internet) it shows **Not saved – Retry**, and the changes are kept on
  that device until they're saved.

## Files

```
index.html     page layout
app.js         all logic (display, live sync, admin editing, import)
style.css      styling (desktop, tablet, mobile, print)
config.js      GitHub owner/repo/branch + how often clients refresh
schedule.json  the schedule data (edited from the website)
vercel.json    tells Vercel not to cache, so updates show immediately
```

## Deploying

Vercel is connected to this repo and deploys the `main` branch to
https://132-emerald-schedule.vercel.app. It's a static site — no build
command. Pull requests get their own preview URL.

To reuse this for another project: copy the repo, change `config.js`
(`repo` name), reset `schedule.json`, connect the new repo to Vercel, and
create a token for the new repo.
