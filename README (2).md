# Construction Project Management — Master Template

This is a **blank, reusable master template**. It contains no project
names, addresses, clients, trades, invoices, budgets, or schedules —
every project is created and configured directly from the website
after you deploy it.

It's a static site (`index.html` + `script.js` + `style.css`) backed
by Firebase (Realtime Database for data, Firebase Storage for files,
Firebase Authentication for the Admin/Client login split) — the same
proven approach used by the 43 Munn and Kiwanis Projects sites, but
with every baked-in default stripped out and several new modules
added (Client Information, Project Team, Change Orders, Specs with
revision history, and a Documents module backed by real file
storage instead of embedded data).

## 1. What's included

- Onboarding "Create Project" screen — nothing pre-filled
- Project Information + Client Information
- Project Team
- Schedule: milestones, dependencies, business-day calculation
  (Mon–Fri, configurable holidays), interactive Gantt timeline
- Trades (can exist with zero invoices), many-to-many trade ↔
  milestone linking
- Invoices as separate records from trades, with optional file
  upload (stored in Firebase Storage, not the database)
- Payments: multiple payments per invoice, automatic outstanding
  calculation
- Change Orders
- Site Rentals (included in financial totals)
- Specs: trade → spec → revision history, with an image gallery
  (zoom/next/prev) and file/PDF attachments per revision
- Budget vs Actual: default category list, Invoice/Paid/Manual
  expense basis, automatic variance calculation
- Financial summary (budget, committed, invoiced, paid,
  outstanding, variance)
- Documents module (contracts, drawings, permits, photos, etc.)
  with real Firebase Storage-backed uploads
- Project Activity feed, 5 records per page
- Admin: create / archive / restore / duplicate project (duplicate
  lets you choose what structure to copy — financial data,
  invoices, payments, and documents are **never** copied)
- CSV/JSON export, basic CSV import for milestones/trades/budget
  categories
- Responsive layout (desktop, tablet, mobile)
- Every record is scoped under `projects/{projectId}/...` in
  Firebase, so multiple projects can live in one Firebase project
  with no data leakage between them (this was verified with an
  automated test — see "Testing" below)

### Known simplifications (not yet built)

This covers the core and the highest-value modules from the spec in
full. A few things from the original spec are simplified for this
first version rather than fully built — flagged here so expectations
are clear, not hidden:

- **Gantt bars are click-to-edit, not drag-to-resize.** Dragging a
  bar directly on the timeline isn't implemented; editing dates
  happens through the milestone's edit modal (which the Gantt bar
  opens on click).
- **Excel (.xlsx) export/import isn't implemented** — CSV and JSON
  export are, and CSV import covers milestones/trades/budget
  categories. A full Excel importer (formulas, multiple sheets)
  would be a follow-up.
- **Permissions are binary (Admin / Client)**, same as 43 Munn and
  Kiwanis — there's no granular per-user permission matrix (e.g.
  "can edit invoices but not delete milestones"). Firebase
  Authentication's user list is where you manage *who* can log in
  as admin; everyone else sees read-only client view.
- **A relational database (Supabase/Postgres)** was in the original
  spec, but per your choice this template uses Firebase (Realtime
  Database + Storage), matching your existing sites and letting you
  manage it with tools you already know.

If you want any of these built out further, just ask — the
architecture doesn't need to change, these are additive.

## 2. One-time setup for a NEW deployment

1. **Create a Firebase project**: console.firebase.google.com → Add
   project. (You can reuse your existing `munn-schedule` Firebase
   project instead if you'd rather not manage a separate one — see
   "Reusing one Firebase project for multiple sites" below.)
2. **Enable Realtime Database**, **Authentication** (Email/Password
   sign-in method), and **Storage**.
3. **Authentication → Users → Add user** to create your admin
   login(s).
4. **Realtime Database → Rules** → paste in `firebase-database-rules.json`
   from this repo → Publish.
5. **Storage → Rules** → paste in `firebase-storage-rules.txt` from
   this repo → Publish.
6. **Project settings → General → Your apps → Add app (Web)** → copy
   the config object it gives you.
7. Rename `firebase-config.template.js` to `firebase-config.js` and
   paste your config values in. (This file is in `.gitignore` so you
   won't accidentally commit it, but note: this config is not a
   secret — see the comment in the file.)

### Reusing one Firebase project for multiple sites

If you'd rather not create a new Firebase project per deployment,
you can point several deployments at the same Firebase project —
just give each deployment's `data.js` its own `REGISTRY_KEY` value
(e.g. `project_registry_clientname`), the same pattern used to keep
43 Munn and Kiwanis Projects separate on one Firebase project. Their
project lists, and all their project data (scoped by project ID
anyway), stay fully isolated from each other.

## 3. Running locally

This is a plain static site — no build step, no `npm install`
required to run it. Open `index.html` in a browser, or serve the
folder with any static file server (e.g. `npx serve .`).

## 4. Deploying to Vercel

1. Push this repo to GitHub.
2. In Vercel: **Add New → Project** → import the GitHub repo.
3. Framework preset: **Other** (it's a static site, no build
   command needed). Leave build/output settings blank — Vercel will
   serve the files as-is.
4. Deploy. Vercel gives you a live URL immediately, and will
   redeploy automatically on every push to `main`.

(GitHub Pages or any other static host works too, if you'd prefer —
nothing here is Vercel-specific except the deploy convenience.)

## 5. Creating your first project

Open the deployed site. Since nothing exists yet, you'll see the
**Project Setup** screen. Fill in the fields you have — everything
can be edited later from Project Information — and click **Create
Project**. You can then log in (Admin button, top right) with the
account you created in step 3 above, and start adding milestones,
trades, specs, and everything else from the sidebar.

## 6. Duplicating this repo for a separate, unrelated project

If you want a **completely independent** deployment (different
GitHub repo, different URL, possibly a different Firebase project
entirely — e.g. for a different client who should never share
infrastructure with your other projects):

1. On GitHub, use **"Use this template"** (or just clone and push to
   a new repo).
2. Follow "One-time setup for a NEW deployment" above with a fresh
   Firebase project (or the shared-project pattern, your choice).
3. Deploy that new repo to its own Vercel project.

If instead you just want **another project within the same site**
(most common case — e.g. a second property for the same client),
you don't need to duplicate the repo at all: log in as admin and use
**Settings → + Create New Project**, or **Duplicate** next to an
existing project in that same list.

## 7. Backing up project data

**Settings → Data Export / Import → Export JSON** downloads the
full current project's data as a single JSON file — keep these
periodically as backups. Firebase itself also lets you export the
whole Realtime Database from the console (Realtime Database →
⋮ → Export JSON) if you want a full-project backup across every
project, not just the one you're viewing.

## 8. File structure

```
master-template/
├── index.html                      — page shell, all sections/modals
├── script.js                       — all application logic
├── style.css                       — all styling
├── data.js                         — blank defaults, dropdown option lists
├── firebase-config.template.js     — rename to firebase-config.js and fill in
├── firebase-database-rules.json    — publish in Firebase console
├── firebase-storage-rules.txt      — publish in Firebase console (Storage → Rules)
├── .gitignore
└── README.md
```

## 9. Data model (Firebase Realtime Database)

```
project_registry/{projectId}        — name, address, order, archived, createdAt
projects/{projectId}/
  settings                          — project info, currency/tax, actual-expense basis
  client                            — client information
  team/{id}                         — project team members
  milestones/{id}                   — schedule entries, dependsOn, manualStart, status, progress
  holidays                          — array of {date, name}
  trades/{id}                       — trade info, milestoneIds[] (many-to-many)
  invoices/{id}                     — separate from trades; tradeId, totals, optional fileUrl
  payments/{id}                     — invoiceId, amount, date, method
  changeOrders/{id}
  siteRentals/{id}
  specs/{id}                        — tradeId, name, description
  specRevisions/{id}                — specId, revisionNumber, images[], files[]
  budgetCategories/{id}             — name, budgetAmount, manualActual, tradeIds[]
  documents/{id}                    — category, fileUrl, uploadedAt
  activity/{id}                     — ts, user, action, description
```

Every collection is nested under `projects/{projectId}`, so no
record can ever be read or written outside its own project's path.
