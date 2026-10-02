/* ============================================================
   CONSTRUCTION PROJECT MANAGEMENT — MASTER TEMPLATE
   script.js
   ------------------------------------------------------------
   Blank, reusable engine. No project-specific data is baked in
   anywhere in this file. Everything a project needs is created
   from the website (onboarding screen + each module's "+ Add"
   buttons) and stored in Firebase, scoped under
   projects/{projectId}/... so multiple projects can exist in one
   Firebase project with zero data leakage between them.
   ============================================================ */

/* ---------- Project selection / registry ---------- */
const LAST_PROJECT_STORAGE_KEY = "lastProjectId_" + REGISTRY_KEY;
let CURRENT_PROJECT_ID = null;
try { CURRENT_PROJECT_ID = localStorage.getItem(LAST_PROJECT_STORAGE_KEY) || null; } catch (e) {}

let USER_ROLE = "client"; // "admin" | "client" -- UI only, real enforcement is Firebase rules
let CURRENT_USER = null;
let PROJECT_REGISTRY = {};
let FIREBASE_READY = false;
let REFS = {}; // live listener refs for the current project, so we can detach on switch

const STATE = {
  settings: deepClone(DEFAULT_SETTINGS),
  client: deepClone(DEFAULT_CLIENT),
  holidays: [],
  milestones: [],
  trades: [],
  invoices: [],
  payments: [],
  changeOrders: [],
  siteRentals: [],
  specs: [],
  specRevisions: [],
  budgetCategories: [],
  documents: [],
  team: [],
  activity: [],
  activityPage: 1,
  statusFilter: "All",
  openId: null,
  openKind: null,
  lightbox: { images: [], index: 0 },
};

function deepClone(o) { return JSON.parse(JSON.stringify(o)); }
function uid(prefix) { return (prefix || "id") + "_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8); }
function escapeHtml(s) { return (s == null ? "" : String(s)).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function escapeAttr(s) { return escapeHtml(s); }
function fmtMoney(n) {
  const cur = (STATE.settings.currency || "USD");
  const sym = cur === "USD" ? "$" : cur === "CAD" ? "$" : cur + " ";
  return sym + (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtPct(n) { return Math.round(Number(n) || 0) + "%"; }
function parseISO(s) { if (!s) return null; const [y, m, d] = s.split("-").map(Number); return new Date(y, (m || 1) - 1, d || 1); }
function toISO(d) { if (!d) return ""; const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), dd = String(d.getDate()).padStart(2, "0"); return `${y}-${m}-${dd}`; }
function fmtDateShort(d) { if (!d) return "—"; return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }); }

/* ---------- Business-day engine ---------- */
function isHoliday(d) { const iso = toISO(d); return (STATE.holidays || []).some(h => h.date === iso); }
function isBusinessDay(d) { const day = d.getDay(); return day !== 0 && day !== 6 && !isHoliday(d); }
function addBusinessDays(start, days) {
  let d = new Date(start.getTime());
  let remaining = Math.max(0, days - 1);
  if (!isBusinessDay(d)) remaining++; // if start itself isn't a business day, nudge forward below
  while (!isBusinessDay(d)) d.setDate(d.getDate() + 1);
  while (remaining > 0) { d.setDate(d.getDate() + 1); if (isBusinessDay(d)) remaining--; }
  return d;
}
function calculateBusinessDays(start, finish) {
  if (!start || !finish) return 0;
  let count = 0; let d = new Date(start.getTime());
  while (d <= finish) { if (isBusinessDay(d)) count++; d.setDate(d.getDate() + 1); }
  return Math.max(1, count);
}

/* Computes start/finish for every milestone based on dependency
   chains + manual overrides. Milestones with no dependency start
   at the project's start date. A milestone depending on another
   starts the business day after its dependency's finish date. */
function computeSchedule() {
  const byId = {}; STATE.milestones.forEach(m => byId[m.id] = m);
  const schedule = {};
  const visiting = new Set();

  function resolve(id) {
    if (schedule[id]) return schedule[id];
    const m = byId[id]; if (!m) return null;
    if (visiting.has(id)) return schedule[id] = { start: parseISO(STATE.settings.start) || new Date(), finish: parseISO(STATE.settings.start) || new Date() };
    visiting.add(id);
    let start;
    if (m.manualStart) {
      start = parseISO(m.manualStart);
    } else if (m.dependsOn) {
      const dep = resolve(m.dependsOn);
      start = dep ? addBusinessDays(dep.finish, 2) : (parseISO(STATE.settings.start) || new Date());
    } else {
      start = parseISO(STATE.settings.start) || new Date();
    }
    const finish = addBusinessDays(start, m.duration || 1);
    schedule[id] = { start, finish };
    visiting.delete(id);
    return schedule[id];
  }
  STATE.milestones.forEach(m => resolve(m.id));
  return schedule;
}

function getProjectedCompletion(schedule) {
  let latest = null;
  Object.values(schedule).forEach(s => { if (!latest || s.finish > latest) latest = s.finish; });
  return latest;
}

function getOnTrackScore(schedule) {
  if (!STATE.milestones.length) return 0;
  const today = new Date();
  const target = parseISO(STATE.settings.targetCompletion);
  const projected = getProjectedCompletion(schedule);
  let varianceDays = 0;
  if (target && projected) varianceDays = Math.round((projected - target) / 86400000);
  const counts = {};
  STATE.milestones.forEach(m => { counts[m.status] = (counts[m.status] || 0) + 1; });
  let score = 100;
  if (varianceDays > 0) score -= Math.min(50, varianceDays * 2.5);
  else if (varianceDays < 0) score += Math.min(5, Math.abs(varianceDays) * 0.2);
  score -= (counts["Delayed"] || 0) * 12;
  score -= (counts["On Hold"] || 0) * 6;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function getCompletionPct() {
  if (!STATE.milestones.length) return 0;
  const total = STATE.milestones.reduce((s, m) => s + (Number(m.progress) || 0), 0);
  return Math.round(total / STATE.milestones.length);
}

/* ---------- File uploads (degrade gracefully if Storage isn't enabled) ----------
   Firebase Storage requires the Blaze (pay-as-you-go) plan. If a project
   hasn't upgraded yet, storage.ref().put() rejects. Rather than letting
   that break invoice/spec/document saving entirely, every upload goes
   through this helper: on failure, it warns once per session and
   resolves to null so the calling code can save the record without a
   file attached. Turning on Storage later needs no code changes --
   uploads just start succeeding. */
let STORAGE_WARNED = false;
function safeUpload(path, file) {
  if (typeof storage === "undefined" || !file) return Promise.resolve(null);
  const sref = storage.ref(path);
  return sref.put(file).then(snap => snap.ref.getDownloadURL()).then(url => ({ name: file.name, url })).catch(err => {
    if (!STORAGE_WARNED) {
      STORAGE_WARNED = true;
      alert("File storage isn't enabled for this project yet (Firebase Storage requires upgrading to the Blaze plan). This was saved without the attached file -- everything else works normally. Enable Storage in the Firebase console whenever you're ready, no other changes needed.");
    }
    return null;
  });
}

/* ---------- Firebase paths ---------- */
function ref(path) { return db.ref(`projects/${CURRENT_PROJECT_ID}/${path}`); }

function firebaseUnlisten() {
  Object.values(REFS).forEach(r => { try { r.ref.off("value", r.cb); } catch (e) {} });
  REFS = {};
}

function listenCollection(path, stateKey, sanitize) {
  const r = ref(path);
  const cb = snap => {
    const val = snap.val() || {};
    STATE[stateKey] = Object.keys(val).map(id => Object.assign({ id }, val[id]));
    renderAll();
  };
  r.on("value", cb);
  REFS[path] = { ref: r, cb };
}

function saveCollectionItem(path, item) {
  const id = item.id || uid(path);
  const copy = Object.assign({}, item); delete copy.id;
  return ref(`${path}/${id}`).set(copy).then(() => id);
}
function deleteCollectionItem(path, id) { return ref(`${path}/${id}`).remove(); }

function firebaseListenProject() {
  if (!CURRENT_PROJECT_ID) { renderAll(); return; }
  firebaseUnlisten();
  FIREBASE_READY = false;

  const settingsRef = ref("settings");
  const settingsCb = snap => {
    STATE.settings = Object.assign(deepClone(DEFAULT_SETTINGS), snap.val() || {});
    FIREBASE_READY = true;
    renderAll();
  };
  settingsRef.on("value", settingsCb);
  REFS["settings"] = { ref: settingsRef, cb: settingsCb };

  const clientRef = ref("client");
  const clientCb = snap => { STATE.client = Object.assign(deepClone(DEFAULT_CLIENT), snap.val() || {}); renderAll(); };
  clientRef.on("value", clientCb);
  REFS["client"] = { ref: clientRef, cb: clientCb };

  const holidaysRef = ref("holidays");
  const holidaysCb = snap => { const v = snap.val(); STATE.holidays = Array.isArray(v) ? v.filter(Boolean) : Object.values(v || {}); renderAll(); };
  holidaysRef.on("value", holidaysCb);
  REFS["holidays"] = { ref: holidaysRef, cb: holidaysCb };

  ["milestones", "trades", "invoices", "payments", "changeOrders", "siteRentals", "specs", "specRevisions", "budgetCategories", "documents", "team"]
    .forEach(key => listenCollection(key, key));

  const activityRef = ref("activity");
  const activityCb = snap => {
    const val = snap.val() || {};
    STATE.activity = Object.keys(val).map(id => Object.assign({ id }, val[id])).sort((a, b) => (b.ts || 0) - (a.ts || 0));
    renderAll();
  };
  activityRef.on("value", activityCb);
  REFS["activity"] = { ref: activityRef, cb: activityCb };
}

function logActivity(action, description) {
  if (!CURRENT_PROJECT_ID) return;
  const entry = { ts: Date.now(), user: (CURRENT_USER && CURRENT_USER.email) || "Client", action, description: description || "" };
  ref(`activity/${uid("act")}`).set(entry);
}

/* ---------- Project registry (list of all projects) ---------- */
function slugify(s) { return (s || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "project"; }
function uniqueProjectId(base) {
  let id = slugify(base), n = 2;
  while (PROJECT_REGISTRY[id]) { id = slugify(base) + "-" + n; n++; }
  return id;
}

function listenProjectRegistry() {
  if (typeof db === "undefined") return;
  db.ref(REGISTRY_KEY).on("value", snap => {
    PROJECT_REGISTRY = snap.val() || {};
    renderProjectSwitcher();
    renderAdminProjectsList();
    if (!CURRENT_PROJECT_ID) {
      const first = Object.keys(PROJECT_REGISTRY).find(id => !PROJECT_REGISTRY[id].archived);
      if (first) switchProject(first);
    }
    renderOnboardingGate();
  });
}

function renderOnboardingGate() {
  const hasAnyProject = Object.keys(PROJECT_REGISTRY).length > 0 || !!CURRENT_PROJECT_ID;
  const isAdmin = USER_ROLE === "admin";
  document.getElementById("sectionOnboarding").classList.toggle("hidden", hasAnyProject);
  document.querySelectorAll(".content > section:not(#sectionOnboarding)").forEach(s => {
    if (!hasAnyProject) s.classList.add("hidden");
  });
  // The "Create Project" setup form is an admin-only action (Firebase rules
  // also require auth to write it) -- visitors who aren't logged in see a
  // neutral placeholder instead, never the create-project screen.
  const adminForm = document.getElementById("onboardingAdminForm");
  const visitorMsg = document.getElementById("onboardingVisitorMessage");
  if (adminForm) adminForm.classList.toggle("hidden", !isAdmin);
  if (visitorMsg) visitorMsg.classList.toggle("hidden", isAdmin);
  if (hasAnyProject) showSection(window.__activeSection || "overview");
}

function switchProject(projectId) {
  if (!projectId || projectId === CURRENT_PROJECT_ID) return;
  CURRENT_PROJECT_ID = projectId;
  try { localStorage.setItem(LAST_PROJECT_STORAGE_KEY, projectId); } catch (e) {}
  Object.assign(STATE, {
    settings: deepClone(DEFAULT_SETTINGS), client: deepClone(DEFAULT_CLIENT), holidays: [],
    milestones: [], trades: [], invoices: [], payments: [], changeOrders: [], siteRentals: [],
    specs: [], specRevisions: [], budgetCategories: [], documents: [], team: [], activity: [], activityPage: 1,
  });
  firebaseListenProject();
  renderProjectSwitcher();
  renderOnboardingGate();
}

function createProject(form) {
  const name = (form.name || "").trim();
  if (!name) { alert("Project Name is required."); return; }
  const id = uniqueProjectId(form.number ? name + "-" + form.number : name);
  const registryEntry = { name, address: form.address || "", order: Object.keys(PROJECT_REGISTRY).length, archived: false, createdAt: Date.now() };
  const settings = Object.assign(deepClone(DEFAULT_SETTINGS), {
    title: name, projectNumber: form.number || "", address: form.address || "", city: form.city || "",
    province: form.province || "", postalCode: form.postal || "", projectType: form.type || "",
    status: form.status || "Planning", start: form.start || "", targetCompletion: form.target || "",
    projectManager: form.pm || "",
  });
  const client = form.client ? Object.assign(deepClone(DEFAULT_CLIENT), { name: form.client }) : deepClone(DEFAULT_CLIENT);

  const updates = {};
  updates[`${REGISTRY_KEY}/${id}`] = registryEntry;
  updates[`projects/${id}/settings`] = settings;
  updates[`projects/${id}/client`] = client;
  return db.ref().update(updates).then(() => {
    switchProject(id);
    logActivity("Project created", name);
  }).catch(err => alert("Could not create project: " + err.message));
}

function archiveProject(id) { db.ref(`${REGISTRY_KEY}/${id}/archived`).set(true); }
function restoreProject(id) { db.ref(`${REGISTRY_KEY}/${id}/archived`).set(false); }

function duplicateProject(sourceId, newName, copyOptions) {
  const src = PROJECT_REGISTRY[sourceId]; if (!src) return;
  const id = uniqueProjectId(newName);
  const updates = {};
  updates[`${REGISTRY_KEY}/${id}`] = { name: newName, address: "", order: Object.keys(PROJECT_REGISTRY).length, archived: false, createdAt: Date.now() };

  const readSrc = (path) => db.ref(`projects/${sourceId}/${path}`).once("value").then(s => s.val() || {});

  Promise.all([readSrc("settings"), readSrc("client"), readSrc("milestones"), readSrc("trades"), readSrc("budgetCategories"), readSrc("team")])
    .then(([settings, client, milestones, trades, budgetCategories, team]) => {
      updates[`projects/${id}/settings`] = Object.assign({}, settings, { title: newName });
      if (copyOptions.team) updates[`projects/${id}/client`] = client; else updates[`projects/${id}/client`] = deepClone(DEFAULT_CLIENT);
      if (copyOptions.milestones) {
        const idMap = {};
        Object.keys(milestones || {}).forEach(oldId => { idMap[oldId] = uid("m"); });
        Object.entries(milestones || {}).forEach(([oldId, m]) => {
          const copy = Object.assign({}, m, { progress: 0, status: "Not Started" });
          if (copy.dependsOn && idMap[copy.dependsOn]) copy.dependsOn = idMap[copy.dependsOn];
          updates[`projects/${id}/milestones/${idMap[oldId]}`] = copy;
        });
      }
      if (copyOptions.trades) {
        Object.entries(trades || {}).forEach(([oldId, t]) => {
          updates[`projects/${id}/trades/${uid("t")}`] = Object.assign({}, t, { contractValue: 0, status: "Active" });
        });
      }
      if (copyOptions.budget) {
        Object.entries(budgetCategories || {}).forEach(([oldId, b]) => {
          updates[`projects/${id}/budgetCategories/${uid("b")}`] = Object.assign({}, b, { budgetAmount: 0, manualActual: 0, tradeIds: [] });
        });
      }
      if (copyOptions.team) {
        Object.entries(team || {}).forEach(([oldId, m]) => { updates[`projects/${id}/team/${uid("tm")}`] = m; });
      }
      // Invoices, payments, actual expenses, change orders, and documents are
      // NEVER copied, per the master-template duplication rule.
      return db.ref().update(updates);
    })
    .then(() => switchProject(id));
}

/* ---------- Rendering: shell ---------- */
function showSection(name) {
  window.__activeSection = name;
  document.querySelectorAll(".nav-item").forEach(b => b.classList.toggle("active", b.dataset.section === name));
  const map = {
    overview: "sectionOverview", projectInfo: "sectionProjectInfo", schedule: "sectionSchedule",
    milestones: "sectionMilestones", trades: "sectionTrades", specs: "sectionSpecs", budget: "sectionBudget",
    financials: "sectionFinancials", invoices: "sectionInvoices", payments: "sectionPayments",
    changeOrders: "sectionChangeOrders", siteRentals: "sectionSiteRentals", documents: "sectionDocuments",
    team: "sectionTeam", activity: "sectionActivity", settings: "sectionSettings",
  };
  document.querySelectorAll(".content > section").forEach(s => s.classList.add("hidden"));
  const target = document.getElementById(map[name] || "sectionOverview");
  if (target) target.classList.remove("hidden");
}

function renderAll() {
  if (!CURRENT_PROJECT_ID) return;
  renderTopbar();
  renderDashboard();
  renderProjectInfoForm();
  renderClientForm();
  renderMilestonesTable();
  renderGantt();
  renderHolidays();
  renderTrades();
  renderSpecs();
  renderBudget();
  renderFinancials();
  renderInvoices();
  renderPayments();
  renderChangeOrders();
  renderSiteRentals();
  renderDocuments();
  renderTeam();
  renderActivity();
  renderSettingsPanel();
  applyRoleUI();
}

function applyRoleUI() {
  const isAdmin = USER_ROLE === "admin";
  document.getElementById("btnLogin").style.display = isAdmin ? "none" : "";
  document.getElementById("btnLogout").style.display = isAdmin ? "" : "none";
  document.querySelectorAll("[data-admin-only]").forEach(el => el.style.display = isAdmin ? "" : "none");
  document.querySelectorAll(".btn-primary, .row-actions button").forEach(el => { if (!isAdmin) el.setAttribute("disabled", "disabled"); else el.removeAttribute("disabled"); });
}

function renderTopbar() {
  document.getElementById("topbarProjectName").textContent = STATE.settings.title || "Untitled Project";
  document.getElementById("topbarProjectAddress").textContent = STATE.settings.address || "Not configured";
  const img = document.getElementById("companyLogoImg");
  if (STATE.settings.companyLogoDataUrl) { img.src = STATE.settings.companyLogoDataUrl; img.style.display = ""; } else { img.style.display = "none"; }
}

function renderProjectSwitcher() {
  const el = document.getElementById("projectSwitcher");
  const list = Object.keys(PROJECT_REGISTRY).filter(id => !PROJECT_REGISTRY[id].archived)
    .map(id => ({ id, name: PROJECT_REGISTRY[id].name })).sort((a, b) => (PROJECT_REGISTRY[a.id].order || 0) - (PROJECT_REGISTRY[b.id].order || 0));
  if (CURRENT_PROJECT_ID && !list.some(p => p.id === CURRENT_PROJECT_ID)) list.unshift({ id: CURRENT_PROJECT_ID, name: STATE.settings.title || CURRENT_PROJECT_ID });
  el.innerHTML = list.map(p => `<option value="${escapeAttr(p.id)}" ${p.id === CURRENT_PROJECT_ID ? "selected" : ""}>${escapeHtml(p.name)}</option>`).join("");
}

function renderAdminProjectsList() {
  const el = document.getElementById("adminProjectsList"); if (!el) return;
  const ids = Object.keys(PROJECT_REGISTRY);
  if (!ids.length) { el.innerHTML = `<p class="muted">No projects yet.</p>`; return; }
  el.innerHTML = ids.map(id => {
    const p = PROJECT_REGISTRY[id];
    return `<div class="admin-project-row">
      <span>${escapeHtml(p.name)}${p.archived ? " (archived)" : ""}</span>
      <span>
        <button class="btn btn-sm" data-open-project="${escapeAttr(id)}">Open</button>
        ${p.archived ? `<button class="btn btn-sm" data-restore-project="${escapeAttr(id)}">Restore</button>`
          : `<button class="btn btn-sm" data-archive-project="${escapeAttr(id)}">Archive</button>`}
        <button class="btn btn-sm" data-duplicate-project="${escapeAttr(id)}">Duplicate</button>
      </span>
    </div>`;
  }).join("");
  el.querySelectorAll("[data-open-project]").forEach(b => b.onclick = () => switchProject(b.dataset.openProject));
  el.querySelectorAll("[data-archive-project]").forEach(b => b.onclick = () => archiveProject(b.dataset.archiveProject));
  el.querySelectorAll("[data-restore-project]").forEach(b => b.onclick = () => restoreProject(b.dataset.restoreProject));
  el.querySelectorAll("[data-duplicate-project]").forEach(b => b.onclick = () => openDuplicateModal(b.dataset.duplicateProject));
}

/* ---------- Dashboard ---------- */
function renderDashboard() {
  const schedule = computeSchedule();
  document.getElementById("dashProjectName").textContent = STATE.settings.title || "Project";
  document.getElementById("ovAddress").textContent = STATE.settings.address || "Not configured";
  document.getElementById("mCompletion").textContent = fmtPct(getCompletionPct());
  document.getElementById("mOnTrack").textContent = STATE.milestones.length ? fmtPct(getOnTrackScore(schedule)) : "0%";
  document.getElementById("mScheduleStatus").textContent = STATE.milestones.length ? (STATE.settings.status || "Planning") : "Not started";

  const totals = financialTotals();
  document.getElementById("mBudget").textContent = fmtMoney(totals.totalBudget);
  document.getElementById("mCommitted").textContent = fmtMoney(totals.committed);
  document.getElementById("mInvoiced").textContent = fmtMoney(totals.invoiced);
  document.getElementById("mPaid").textContent = fmtMoney(totals.paid);
  document.getElementById("mOutstanding").textContent = fmtMoney(totals.outstanding);
}

/* ---------- Project Information / Client forms ---------- */
const PROJECT_INFO_FIELDS = [
  ["title", "Project Name"], ["projectNumber", "Project Number"], ["address", "Project Address"],
  ["city", "City"], ["province", "Province/State"], ["postalCode", "Postal/ZIP Code"],
  ["projectType", "Project Type"], ["projectManager", "Project Manager"], ["superintendent", "Superintendent"],
  ["projectCoordinator", "Project Coordinator"], ["start", "Start Date", "date"], ["targetCompletion", "Target Completion", "date"],
  ["description", "Description"], ["notes", "Project Notes"],
];
function renderProjectInfoForm() {
  const el = document.getElementById("projectInfoForm"); if (!el) return;
  el.innerHTML = PROJECT_INFO_FIELDS.map(([key, label, type]) =>
    `<label>${label}<input data-field="${key}" type="${type || "text"}" value="${escapeAttr(STATE.settings[key] || "")}" /></label>`).join("");
}
function saveProjectInfo() {
  const updates = {};
  document.querySelectorAll("#projectInfoForm [data-field]").forEach(inp => { updates[inp.dataset.field] = inp.value; STATE.settings[inp.dataset.field] = inp.value; });
  ref("settings").update(updates).then(() => logActivity("Project edited", "Project information updated."));
}

const CLIENT_FIELDS = [
  ["name", "Client Name"], ["company", "Company Name"], ["email", "Client Email"], ["phone", "Client Phone"],
  ["billingAddress", "Billing Address"], ["mailingAddress", "Mailing Address"], ["repName", "Client Representative"],
  ["repEmail", "Representative Email"], ["repPhone", "Representative Phone"], ["notes", "Notes"],
];
function renderClientForm() {
  const el = document.getElementById("clientForm"); if (!el) return;
  el.innerHTML = CLIENT_FIELDS.map(([key, label]) => `<label>${label}<input data-field="${key}" value="${escapeAttr(STATE.client[key] || "")}" /></label>`).join("");
}
function saveClientInfo() {
  const updates = {};
  document.querySelectorAll("#clientForm [data-field]").forEach(inp => { updates[inp.dataset.field] = inp.value; });
  ref("client").set(Object.assign({}, STATE.client, updates)).then(() => logActivity("Project edited", "Client information updated."));
}

/* ---------- Milestones ---------- */
function renderMilestonesTable() {
  const tbody = document.getElementById("milestonesTableBody");
  document.getElementById("milestonesEmpty").classList.toggle("hidden", STATE.milestones.length > 0);
  const schedule = computeSchedule();
  tbody.innerHTML = STATE.milestones.map(m => {
    const s = schedule[m.id] || {};
    const tradeNames = STATE.trades.filter(t => (t.milestoneIds || []).includes(m.id)).map(t => t.name).join(", ");
    return `<tr>
      <td>${escapeHtml(m.name)}</td><td>${fmtDateShort(s.start)}</td><td>${fmtDateShort(s.finish)}</td>
      <td>${m.duration}d</td><td>${escapeHtml(m.status)}</td><td>${m.progress || 0}%</td><td>${escapeHtml(tradeNames)}</td>
      <td class="row-actions"><button data-edit-milestone="${m.id}">Edit</button><button data-delete-milestone="${m.id}">Delete</button></td>
    </tr>`;
  }).join("");
  tbody.querySelectorAll("[data-edit-milestone]").forEach(b => b.onclick = () => openMilestoneModal(b.dataset.editMilestone));
  tbody.querySelectorAll("[data-delete-milestone]").forEach(b => b.onclick = () => { if (confirm("Delete this milestone?")) deleteCollectionItem("milestones", b.dataset.deleteMilestone).then(() => logActivity("Milestone edited", "Milestone deleted.")); });
}

function openMilestoneModal(id) {
  const m = id ? STATE.milestones.find(x => x.id === id) : { id: null, name: "", duration: 1, status: "Not Started", progress: 0, dependsOn: "", manualStart: "", notes: "" };
  const depOptions = STATE.milestones.filter(x => x.id !== id).map(x => `<option value="${x.id}" ${m.dependsOn === x.id ? "selected" : ""}>${escapeHtml(x.name)}</option>`).join("");
  document.getElementById("modalBody").innerHTML = `
    <h2>${id ? "Edit" : "Add"} Milestone</h2>
    <label>Name<input id="mfName" value="${escapeAttr(m.name)}" /></label>
    <label>Duration (business days)<input id="mfDuration" type="number" min="1" value="${m.duration || 1}" /></label>
    <label>Depends On<select id="mfDepends"><option value="">None</option>${depOptions}</select></label>
    <label>Manual Start Override<input id="mfManualStart" type="date" value="${m.manualStart || ""}" /></label>
    <label>Status<select id="mfStatus">${MILESTONE_STATUSES.map(s => `<option ${s === m.status ? "selected" : ""}>${s}</option>`).join("")}</select></label>
    <label>Progress %<input id="mfProgress" type="number" min="0" max="100" value="${m.progress || 0}" /></label>
    <label>Notes<textarea id="mfNotes">${escapeHtml(m.notes || "")}</textarea></label>
    <div style="margin-top:12px;">
      <button class="btn btn-primary" id="mfSave">Save</button>
      <button class="btn" id="mfCancel">Cancel</button>
    </div>`;
  openModal();
  document.getElementById("mfCancel").onclick = closeModal;
  document.getElementById("mfSave").onclick = () => {
    const item = {
      id: m.id, name: document.getElementById("mfName").value.trim() || "Untitled Milestone",
      duration: Number(document.getElementById("mfDuration").value) || 1,
      dependsOn: document.getElementById("mfDepends").value || null,
      manualStart: document.getElementById("mfManualStart").value || null,
      status: document.getElementById("mfStatus").value, progress: Number(document.getElementById("mfProgress").value) || 0,
      notes: document.getElementById("mfNotes").value,
    };
    if (!item.id) item.order = STATE.milestones.length;
    saveCollectionItem("milestones", item).then(() => { logActivity(id ? "Milestone edited" : "Milestone added", item.name); closeModal(); });
  };
}

function renderHolidays() {
  const el = document.getElementById("holidaysList"); if (!el) return;
  el.innerHTML = (STATE.holidays || []).map((h, i) => `<div>${h.date} — ${escapeHtml(h.name)} <button data-del-holiday="${i}">x</button></div>`).join("") || `<p class="muted">No holidays configured.</p>`;
  el.querySelectorAll("[data-del-holiday]").forEach(b => b.onclick = () => {
    const arr = STATE.holidays.slice(); arr.splice(Number(b.dataset.delHoliday), 1); ref("holidays").set(arr);
  });
}

/* ---------- Gantt ---------- */
function visibleMilestones() {
  return STATE.milestones.filter(m => STATE.statusFilter === "All" || m.status === STATE.statusFilter).sort((a, b) => (a.order || 0) - (b.order || 0));
}
function renderGantt() {
  const container = document.getElementById("ganttBody"); if (!container) return;
  container.innerHTML = "";
  const projectStart = parseISO(STATE.settings.start) || new Date();
  const target = parseISO(STATE.settings.targetCompletion) || new Date(projectStart.getTime() + 90 * 86400000);
  const schedule = computeSchedule();
  const list = visibleMilestones();
  const lastFinish = getProjectedCompletion(schedule) || target;
  const spanEnd = new Date(Math.max(target.getTime(), lastFinish.getTime()));
  const totalDays = Math.max(30, Math.round((spanEnd - projectStart) / 86400000) + 15);
  const PX = 8, LABEL_W = 230;

  const monthsRow = document.getElementById("ganttMonths");
  monthsRow.innerHTML = ""; monthsRow.style.width = (totalDays * PX) + "px"; monthsRow.style.marginLeft = LABEL_W + "px";
  let mCursor = new Date(projectStart.getFullYear(), projectStart.getMonth(), 1);
  while (mCursor <= spanEnd) {
    const offset = Math.round((mCursor - projectStart) / 86400000);
    if (offset >= 0) { const m = document.createElement("div"); m.className = "gantt-month"; m.style.left = (offset * PX) + "px"; m.textContent = mCursor.toLocaleDateString(undefined, { month: "short", year: "2-digit" }); monthsRow.appendChild(m); }
    mCursor.setMonth(mCursor.getMonth() + 1);
  }
  container.style.width = (totalDays * PX) + "px";

  list.forEach(m => {
    const sched = schedule[m.id]; if (!sched) return;
    const row = document.createElement("div"); row.className = "gantt-row";
    const label = document.createElement("div"); label.className = "gantt-label";
    label.innerHTML = `<span class="gname">${escapeHtml(m.name)}</span><span class="gsub">${fmtDateShort(sched.start)} – ${fmtDateShort(sched.finish)} · ${m.duration}d</span>`;
    label.style.width = LABEL_W + "px"; label.onclick = () => openMilestoneModal(m.id);
    row.appendChild(label);
    const lane = document.createElement("div"); lane.className = "gantt-lane"; lane.style.width = (totalDays * PX) + "px";
    const off = Math.round((sched.start - projectStart) / 86400000);
    const span = Math.round((sched.finish - sched.start) / 86400000) + 1;
    const bar = document.createElement("div"); bar.className = "gantt-bar bar-" + statusColor(m.status);
    bar.style.left = (off * PX) + "px"; bar.style.width = Math.max(span * PX - 2, 6) + "px"; bar.onclick = () => openMilestoneModal(m.id);
    const fill = document.createElement("div"); fill.className = "gantt-bar-fill"; fill.style.width = (m.progress || 0) + "%";
    bar.appendChild(fill); lane.appendChild(bar); row.appendChild(lane); container.appendChild(row);
  });
}
function statusColor(status) {
  return { "Not Started": "gray", "In Progress": "blue", "Complete": "green", "Delayed": "red", "On Hold": "amber", "Cancelled": "gray" }[status] || "gray";
}
function renderStatusFilters() {
  const el = document.getElementById("statusFilters"); if (!el) return;
  const statuses = ["All", ...MILESTONE_STATUSES];
  el.innerHTML = statuses.map(s => `<button class="chip ${STATE.statusFilter === s ? "active" : ""}" data-filter="${s}">${s}</button>`).join("");
  el.querySelectorAll("[data-filter]").forEach(b => b.onclick = () => { STATE.statusFilter = b.dataset.filter; renderAll(); });
}

/* ---------- Trades ---------- */
function renderTrades() {
  const tbody = document.getElementById("tradesTableBody"); if (!tbody) return;
  document.getElementById("tradesEmpty").classList.toggle("hidden", STATE.trades.length > 0);
  tbody.innerHTML = STATE.trades.map(t => {
    const milestoneNames = (t.milestoneIds || []).map(id => { const m = STATE.milestones.find(x => x.id === id); return m ? m.name : null; }).filter(Boolean).join(", ");
    return `<tr>
      <td>${escapeHtml(t.name)}</td><td>${escapeHtml(t.company || "")}</td><td>${escapeHtml(t.scopeOfWork || "")}</td>
      <td>${fmtMoney(t.contractValue)}</td><td>${escapeHtml(milestoneNames)}</td><td>${escapeHtml(t.status || "Active")}</td>
      <td class="row-actions"><button data-edit-trade="${t.id}">Edit</button><button data-delete-trade="${t.id}">Delete</button></td>
    </tr>`;
  }).join("");
  tbody.querySelectorAll("[data-edit-trade]").forEach(b => b.onclick = () => openTradeModal(b.dataset.editTrade));
  tbody.querySelectorAll("[data-delete-trade]").forEach(b => b.onclick = () => { if (confirm("Delete this trade?")) deleteCollectionItem("trades", b.dataset.deleteTrade); });
}
function openTradeModal(id) {
  const t = id ? STATE.trades.find(x => x.id === id) : { id: null, name: "", company: "", contact: "", email: "", phone: "", scopeOfWork: "", contractValue: 0, milestoneIds: [], notes: "", status: "Active" };
  const milestoneChecks = STATE.milestones.map(m => `<label class="checkline"><input type="checkbox" value="${m.id}" ${((t.milestoneIds || []).includes(m.id)) ? "checked" : ""}/> ${escapeHtml(m.name)}</label>`).join("");
  document.getElementById("modalBody").innerHTML = `
    <h2>${id ? "Edit" : "Add"} Trade</h2>
    <label>Trade Name<input id="tfName" value="${escapeAttr(t.name)}" /></label>
    <label>Trade Company<input id="tfCompany" value="${escapeAttr(t.company || "")}" /></label>
    <label>Contact<input id="tfContact" value="${escapeAttr(t.contact || "")}" /></label>
    <label>Email<input id="tfEmail" value="${escapeAttr(t.email || "")}" /></label>
    <label>Phone<input id="tfPhone" value="${escapeAttr(t.phone || "")}" /></label>
    <label>Scope of Work<textarea id="tfScope">${escapeHtml(t.scopeOfWork || "")}</textarea></label>
    <label>Contract Value<input id="tfValue" type="number" step="0.01" value="${t.contractValue || 0}" /></label>
    <label>Status<select id="tfStatus"><option ${t.status === "Active" ? "selected" : ""}>Active</option><option ${t.status === "Complete" ? "selected" : ""}>Complete</option><option ${t.status === "On Hold" ? "selected" : ""}>On Hold</option></select></label>
    <label>Milestone Association<div class="checklist">${milestoneChecks || '<span class="muted">No milestones yet.</span>'}</div></label>
    <label>Notes<textarea id="tfNotes">${escapeHtml(t.notes || "")}</textarea></label>
    <p class="muted">A trade does not require an invoice to be saved.</p>
    <div style="margin-top:12px;"><button class="btn btn-primary" id="tfSave">Save</button><button class="btn" id="tfCancel">Cancel</button></div>`;
  openModal();
  document.getElementById("tfCancel").onclick = closeModal;
  document.getElementById("tfSave").onclick = () => {
    const milestoneIds = Array.from(document.querySelectorAll("#modalBody .checklist input:checked")).map(c => c.value);
    const item = {
      id: t.id, name: document.getElementById("tfName").value.trim() || "Untitled Trade",
      company: document.getElementById("tfCompany").value, contact: document.getElementById("tfContact").value,
      email: document.getElementById("tfEmail").value, phone: document.getElementById("tfPhone").value,
      scopeOfWork: document.getElementById("tfScope").value, contractValue: Number(document.getElementById("tfValue").value) || 0,
      status: document.getElementById("tfStatus").value, milestoneIds, notes: document.getElementById("tfNotes").value,
    };
    saveCollectionItem("trades", item).then(() => { logActivity(id ? "Trade edited" : "Trade added", item.name); closeModal(); });
  };
}

/* ---------- Invoices & Payments ---------- */
function invoicePayments(invoiceId) { return STATE.payments.filter(p => p.invoiceId === invoiceId); }
function invoicePaid(invoiceId) { return invoicePayments(invoiceId).reduce((s, p) => s + (Number(p.amount) || 0), 0); }
function invoiceOutstanding(inv) { return (Number(inv.total) || 0) - invoicePaid(inv.id); }
function invoicePaymentStatus(inv) {
  const paid = invoicePaid(inv.id), total = Number(inv.total) || 0;
  if (paid <= 0) return "Unpaid";
  if (paid >= total) return "Paid";
  return "Partially Paid";
}

function renderInvoices() {
  const tbody = document.getElementById("invoicesTableBody"); if (!tbody) return;
  document.getElementById("invoicesEmpty").classList.toggle("hidden", STATE.invoices.length > 0);
  tbody.innerHTML = STATE.invoices.map(inv => {
    const trade = STATE.trades.find(t => t.id === inv.tradeId);
    return `<tr>
      <td>${escapeHtml(inv.invoiceNumber || "")}</td><td>${escapeHtml(trade ? trade.name : "—")}</td>
      <td>${escapeHtml(inv.invoiceDate || "")}</td><td>${escapeHtml(inv.dueDate || "")}</td>
      <td>${fmtMoney(inv.total)}</td><td>${invoicePaymentStatus(inv)}</td>
      <td>${inv.fileUrl ? `<a href="${escapeAttr(inv.fileUrl)}" target="_blank">View</a>` : "Not yet uploaded"}</td>
      <td class="row-actions"><button data-edit-invoice="${inv.id}">Edit</button><button data-delete-invoice="${inv.id}">Delete</button></td>
    </tr>`;
  }).join("");
  tbody.querySelectorAll("[data-edit-invoice]").forEach(b => b.onclick = () => openInvoiceModal(b.dataset.editInvoice));
  tbody.querySelectorAll("[data-delete-invoice]").forEach(b => b.onclick = () => { if (confirm("Delete this invoice?")) deleteCollectionItem("invoices", b.dataset.deleteInvoice); });
}
function openInvoiceModal(id) {
  const inv = id ? STATE.invoices.find(x => x.id === id) : { id: null, invoiceNumber: "", tradeId: "", invoiceDate: "", dueDate: "", subtotal: 0, tax: 0, total: 0, notes: "", fileUrl: "", fileName: "" };
  const tradeOptions = STATE.trades.map(t => `<option value="${t.id}" ${inv.tradeId === t.id ? "selected" : ""}>${escapeHtml(t.name)}</option>`).join("");
  document.getElementById("modalBody").innerHTML = `
    <h2>${id ? "Edit" : "Add"} Invoice</h2>
    <label>Invoice Number<input id="ifNumber" value="${escapeAttr(inv.invoiceNumber)}" /></label>
    <label>Trade<select id="ifTrade"><option value="">Select trade</option>${tradeOptions}</select></label>
    <label>Invoice Date<input id="ifDate" type="date" value="${inv.invoiceDate || ""}" /></label>
    <label>Due Date<input id="ifDue" type="date" value="${inv.dueDate || ""}" /></label>
    <label>Subtotal<input id="ifSubtotal" type="number" step="0.01" value="${inv.subtotal || 0}" /></label>
    <label>${escapeHtml(STATE.settings.taxLabel || "Tax")}<input id="ifTax" type="number" step="0.01" value="${inv.tax || 0}" /></label>
    <label>Total<input id="ifTotal" type="number" step="0.01" value="${inv.total || 0}" /></label>
    <label>Invoice File (optional)<input id="ifFile" type="file" /></label>
    ${inv.fileUrl ? `<p><a href="${escapeAttr(inv.fileUrl)}" target="_blank">Current file: ${escapeHtml(inv.fileName || "view")}</a></p>` : ""}
    <label>Notes<textarea id="ifNotes">${escapeHtml(inv.notes || "")}</textarea></label>
    <div style="margin-top:12px;"><button class="btn btn-primary" id="ifSave">Save</button><button class="btn" id="ifCancel">Cancel</button></div>`;
  openModal();
  document.getElementById("ifCancel").onclick = closeModal;
  document.getElementById("ifSave").onclick = () => {
    const item = {
      id: inv.id, invoiceNumber: document.getElementById("ifNumber").value, tradeId: document.getElementById("ifTrade").value,
      invoiceDate: document.getElementById("ifDate").value, dueDate: document.getElementById("ifDue").value,
      subtotal: Number(document.getElementById("ifSubtotal").value) || 0, tax: Number(document.getElementById("ifTax").value) || 0,
      total: Number(document.getElementById("ifTotal").value) || 0, notes: document.getElementById("ifNotes").value,
      fileUrl: inv.fileUrl || "", fileName: inv.fileName || "",
    };
    const fileInput = document.getElementById("ifFile");
    const finish = () => saveCollectionItem("invoices", item).then(() => { logActivity(id ? "Invoice edited" : "Invoice uploaded", item.invoiceNumber); closeModal(); });
    const file = fileInput.files[0];
    safeUpload(`projects/${CURRENT_PROJECT_ID}/invoices/${uid("file")}_${file ? file.name : ""}`, file).then(result => {
      if (result) { item.fileUrl = result.url; item.fileName = result.name; }
      finish();
    });
  };
}

function renderPayments() {
  const tbody = document.getElementById("paymentsTableBody"); if (!tbody) return;
  tbody.innerHTML = STATE.payments.map(p => {
    const inv = STATE.invoices.find(i => i.id === p.invoiceId);
    return `<tr><td>${escapeHtml(p.date || "")}</td><td>${escapeHtml(inv ? inv.invoiceNumber : "—")}</td><td>${fmtMoney(p.amount)}</td><td>${escapeHtml(p.method || "")}</td><td>${escapeHtml(p.reference || "")}</td>
      <td class="row-actions"><button data-delete-payment="${p.id}">Delete</button></td></tr>`;
  }).join("") || `<tr><td colspan="6" class="muted">No payments recorded yet.</td></tr>`;
  tbody.querySelectorAll("[data-delete-payment]").forEach(b => b.onclick = () => { if (confirm("Delete this payment?")) deleteCollectionItem("payments", b.dataset.deletePayment); });
}
function openAddPaymentModal() {
  const invOptions = STATE.invoices.map(i => `<option value="${i.id}">${escapeHtml(i.invoiceNumber)} — ${fmtMoney(invoiceOutstanding(i))} outstanding</option>`).join("");
  document.getElementById("modalBody").innerHTML = `
    <h2>Add Payment</h2>
    <label>Invoice<select id="pfInvoice">${invOptions || "<option value=''>No invoices yet</option>"}</select></label>
    <label>Payment Date<input id="pfDate" type="date" /></label>
    <label>Amount<input id="pfAmount" type="number" step="0.01" /></label>
    <label>Payment Method<input id="pfMethod" /></label>
    <label>Reference Number<input id="pfReference" /></label>
    <label>Notes<textarea id="pfNotes"></textarea></label>
    <div style="margin-top:12px;"><button class="btn btn-primary" id="pfSave">Save</button><button class="btn" id="pfCancel">Cancel</button></div>`;
  openModal();
  document.getElementById("pfCancel").onclick = closeModal;
  document.getElementById("pfSave").onclick = () => {
    const item = { invoiceId: document.getElementById("pfInvoice").value, date: document.getElementById("pfDate").value,
      amount: Number(document.getElementById("pfAmount").value) || 0, method: document.getElementById("pfMethod").value,
      reference: document.getElementById("pfReference").value, notes: document.getElementById("pfNotes").value };
    if (!item.invoiceId) { alert("Select an invoice."); return; }
    saveCollectionItem("payments", item).then(() => { logActivity("Payment added", fmtMoney(item.amount)); closeModal(); });
  };
}

/* ---------- Change Orders ---------- */
function renderChangeOrders() {
  const tbody = document.getElementById("changeOrdersTableBody"); if (!tbody) return;
  tbody.innerHTML = STATE.changeOrders.map(co => {
    const trade = STATE.trades.find(t => t.id === co.tradeId);
    return `<tr><td>${escapeHtml(co.number || "")}</td><td>${escapeHtml(co.description || "")}</td><td>${escapeHtml(trade ? trade.name : "—")}</td>
      <td>${fmtMoney(co.originalCost)}</td><td>${fmtMoney(co.changeAmount)}</td><td>${fmtMoney((Number(co.originalCost) || 0) + (Number(co.changeAmount) || 0))}</td>
      <td>${escapeHtml(co.status)}</td>
      <td class="row-actions"><button data-edit-co="${co.id}">Edit</button><button data-delete-co="${co.id}">Delete</button></td></tr>`;
  }).join("") || `<tr><td colspan="8" class="muted">No change orders yet.</td></tr>`;
  tbody.querySelectorAll("[data-edit-co]").forEach(b => b.onclick = () => openChangeOrderModal(b.dataset.editCo));
  tbody.querySelectorAll("[data-delete-co]").forEach(b => b.onclick = () => { if (confirm("Delete this change order?")) deleteCollectionItem("changeOrders", b.dataset.deleteCo); });
}
function openChangeOrderModal(id) {
  const co = id ? STATE.changeOrders.find(x => x.id === id) : { id: null, number: "CO-" + (STATE.changeOrders.length + 1), description: "", tradeId: "", originalCost: 0, changeAmount: 0, date: "", status: "Draft", approvedBy: "", approvalDate: "", notes: "" };
  const tradeOptions = STATE.trades.map(t => `<option value="${t.id}" ${co.tradeId === t.id ? "selected" : ""}>${escapeHtml(t.name)}</option>`).join("");
  document.getElementById("modalBody").innerHTML = `
    <h2>${id ? "Edit" : "Add"} Change Order</h2>
    <label>Change Order Number<input id="cfNumber" value="${escapeAttr(co.number)}" /></label>
    <label>Description<textarea id="cfDescription">${escapeHtml(co.description || "")}</textarea></label>
    <label>Trade<select id="cfTrade"><option value="">None</option>${tradeOptions}</select></label>
    <label>Original Cost<input id="cfOriginal" type="number" step="0.01" value="${co.originalCost || 0}" /></label>
    <label>Change Amount<input id="cfChange" type="number" step="0.01" value="${co.changeAmount || 0}" /></label>
    <label>Date<input id="cfDate" type="date" value="${co.date || ""}" /></label>
    <label>Status<select id="cfStatus">${CHANGE_ORDER_STATUSES.map(s => `<option ${s === co.status ? "selected" : ""}>${s}</option>`).join("")}</select></label>
    <label>Approved By<input id="cfApprovedBy" value="${escapeAttr(co.approvedBy || "")}" /></label>
    <label>Approval Date<input id="cfApprovalDate" type="date" value="${co.approvalDate || ""}" /></label>
    <label>Notes<textarea id="cfNotes">${escapeHtml(co.notes || "")}</textarea></label>
    <div style="margin-top:12px;"><button class="btn btn-primary" id="cfSave">Save</button><button class="btn" id="cfCancel">Cancel</button></div>`;
  openModal();
  document.getElementById("cfCancel").onclick = closeModal;
  document.getElementById("cfSave").onclick = () => {
    const item = { id: co.id, number: document.getElementById("cfNumber").value, description: document.getElementById("cfDescription").value,
      tradeId: document.getElementById("cfTrade").value, originalCost: Number(document.getElementById("cfOriginal").value) || 0,
      changeAmount: Number(document.getElementById("cfChange").value) || 0, date: document.getElementById("cfDate").value,
      status: document.getElementById("cfStatus").value, approvedBy: document.getElementById("cfApprovedBy").value,
      approvalDate: document.getElementById("cfApprovalDate").value, notes: document.getElementById("cfNotes").value };
    saveCollectionItem("changeOrders", item).then(() => { logActivity(id ? "Change order edited" : "Change order created", item.number); closeModal(); });
  };
}

/* ---------- Site Rentals ---------- */
function renderSiteRentals() {
  const tbody = document.getElementById("siteRentalsTableBody"); if (!tbody) return;
  tbody.innerHTML = STATE.siteRentals.map(r => {
    const outstanding = (Number(r.invoiced) || 0) - (Number(r.paid) || 0);
    return `<tr><td>${escapeHtml(r.type || "")}</td><td>${escapeHtml(r.vendor || "")}</td><td>${escapeHtml(r.start || "")}</td><td>${escapeHtml(r.end || "")}</td>
      <td>${fmtMoney(r.cost)}</td><td>${fmtMoney(r.invoiced)}</td><td>${fmtMoney(r.paid)}</td><td>${fmtMoney(outstanding)}</td>
      <td class="row-actions"><button data-edit-rental="${r.id}">Edit</button><button data-delete-rental="${r.id}">Delete</button></td></tr>`;
  }).join("") || `<tr><td colspan="9" class="muted">No site rentals yet.</td></tr>`;
  tbody.querySelectorAll("[data-edit-rental]").forEach(b => b.onclick = () => openSiteRentalModal(b.dataset.editRental));
  tbody.querySelectorAll("[data-delete-rental]").forEach(b => b.onclick = () => { if (confirm("Delete this site rental?")) deleteCollectionItem("siteRentals", b.dataset.deleteRental); });
}
function openSiteRentalModal(id) {
  const r = id ? STATE.siteRentals.find(x => x.id === id) : { id: null, type: SITE_RENTAL_TYPES[0], vendor: "", description: "", start: "", end: "", rate: 0, billingFrequency: "Monthly", cost: 0, invoiced: 0, paid: 0, notes: "" };
  document.getElementById("modalBody").innerHTML = `
    <h2>${id ? "Edit" : "Add"} Site Rental</h2>
    <label>Rental Type<select id="rfType">${SITE_RENTAL_TYPES.map(t => `<option ${t === r.type ? "selected" : ""}>${t}</option>`).join("")}</select></label>
    <label>Vendor<input id="rfVendor" value="${escapeAttr(r.vendor || "")}" /></label>
    <label>Description<input id="rfDescription" value="${escapeAttr(r.description || "")}" /></label>
    <label>Start Date<input id="rfStart" type="date" value="${r.start || ""}" /></label>
    <label>End Date<input id="rfEnd" type="date" value="${r.end || ""}" /></label>
    <label>Rate<input id="rfRate" type="number" step="0.01" value="${r.rate || 0}" /></label>
    <label>Estimated/Contract Cost<input id="rfCost" type="number" step="0.01" value="${r.cost || 0}" /></label>
    <label>Invoiced<input id="rfInvoiced" type="number" step="0.01" value="${r.invoiced || 0}" /></label>
    <label>Paid<input id="rfPaid" type="number" step="0.01" value="${r.paid || 0}" /></label>
    <label>Notes<textarea id="rfNotes">${escapeHtml(r.notes || "")}</textarea></label>
    <div style="margin-top:12px;"><button class="btn btn-primary" id="rfSave">Save</button><button class="btn" id="rfCancel">Cancel</button></div>`;
  openModal();
  document.getElementById("rfCancel").onclick = closeModal;
  document.getElementById("rfSave").onclick = () => {
    const item = { id: r.id, type: document.getElementById("rfType").value, vendor: document.getElementById("rfVendor").value,
      description: document.getElementById("rfDescription").value, start: document.getElementById("rfStart").value, end: document.getElementById("rfEnd").value,
      rate: Number(document.getElementById("rfRate").value) || 0, cost: Number(document.getElementById("rfCost").value) || 0,
      invoiced: Number(document.getElementById("rfInvoiced").value) || 0, paid: Number(document.getElementById("rfPaid").value) || 0,
      notes: document.getElementById("rfNotes").value };
    saveCollectionItem("siteRentals", item).then(() => { logActivity(id ? "Site rental edited" : "Site rental added", item.type); closeModal(); });
  };
}

/* ---------- Specs ---------- */
function specRevisions(specId) { return STATE.specRevisions.filter(r => r.specId === specId).sort((a, b) => (b.revisionNumber || 0) - (a.revisionNumber || 0)); }
function renderSpecs() {
  const wrap = document.getElementById("specsByTrade"); if (!wrap) return;
  document.getElementById("specsEmpty").classList.toggle("hidden", STATE.specs.length > 0);
  const byTrade = {};
  STATE.specs.forEach(s => { const key = s.tradeId || "none"; (byTrade[key] = byTrade[key] || []).push(s); });
  wrap.innerHTML = Object.entries(byTrade).map(([tradeId, specs]) => {
    const trade = STATE.trades.find(t => t.id === tradeId);
    return `<div class="spec-group"><h3>${escapeHtml(trade ? trade.name : "Unassigned")}</h3>` +
      specs.map(s => {
        const revs = specRevisions(s.id);
        const latest = revs[0];
        const images = (latest && latest.images) || [];
        return `<div class="spec-card">
          <div class="spec-card-head"><strong>${escapeHtml(s.name)}</strong> <span class="badge">${escapeHtml(s.status || "Active")}</span>
            <button class="btn btn-sm" data-edit-spec="${s.id}">Edit</button>
            <button class="btn btn-sm" data-add-revision="${s.id}">+ Revision</button>
            <button class="btn btn-sm" data-delete-spec="${s.id}">Delete</button>
          </div>
          <p class="muted">${escapeHtml(s.description || "")}</p>
          <div class="revision-history">${revs.map(r => `<span class="chip">Rev ${r.revisionNumber} — ${escapeHtml(r.date || "")}</span>`).join("") || '<span class="muted">No revisions yet.</span>'}</div>
          <div class="spec-gallery">${images.map((img, i) => `<img src="${escapeAttr(img.url)}" data-spec-img="${s.id}" data-idx="${i}" />`).join("")}</div>
          ${(latest && latest.files || []).map(f => `<a href="${escapeAttr(f.url)}" target="_blank">${escapeHtml(f.name)}</a>`).join("<br/>")}
        </div>`;
      }).join("") + `</div>`;
  }).join("");
  wrap.querySelectorAll("[data-edit-spec]").forEach(b => b.onclick = () => openSpecModal(b.dataset.editSpec));
  wrap.querySelectorAll("[data-delete-spec]").forEach(b => b.onclick = () => { if (confirm("Delete this spec?")) deleteCollectionItem("specs", b.dataset.deleteSpec); });
  wrap.querySelectorAll("[data-add-revision]").forEach(b => b.onclick = () => openRevisionModal(b.dataset.addRevision));
  wrap.querySelectorAll("[data-spec-img]").forEach(imgEl => imgEl.onclick = () => {
    const specId = imgEl.dataset.specImg; const revs = specRevisions(specId); const images = (revs[0] && revs[0].images) || [];
    openLightbox(images.map(i => i.url), Number(imgEl.dataset.idx));
  });
}
function openSpecModal(id) {
  const s = id ? STATE.specs.find(x => x.id === id) : { id: null, name: "", tradeId: "", description: "", notes: "", status: "Active" };
  const tradeOptions = STATE.trades.map(t => `<option value="${t.id}" ${s.tradeId === t.id ? "selected" : ""}>${escapeHtml(t.name)}</option>`).join("");
  document.getElementById("modalBody").innerHTML = `
    <h2>${id ? "Edit" : "Add"} Specification</h2>
    <label>Spec Name<input id="sfName" value="${escapeAttr(s.name)}" /></label>
    <label>Trade<select id="sfTrade"><option value="">Unassigned</option>${tradeOptions}</select></label>
    <label>Description<textarea id="sfDescription">${escapeHtml(s.description || "")}</textarea></label>
    <label>Status<select id="sfStatus"><option ${s.status === "Active" ? "selected" : ""}>Active</option><option ${s.status === "Superseded" ? "selected" : ""}>Superseded</option></select></label>
    <label>Notes<textarea id="sfNotes">${escapeHtml(s.notes || "")}</textarea></label>
    <div style="margin-top:12px;"><button class="btn btn-primary" id="sfSave">Save</button><button class="btn" id="sfCancel">Cancel</button></div>`;
  openModal();
  document.getElementById("sfCancel").onclick = closeModal;
  document.getElementById("sfSave").onclick = () => {
    const item = { id: s.id, name: document.getElementById("sfName").value.trim() || "Untitled Spec", tradeId: document.getElementById("sfTrade").value,
      description: document.getElementById("sfDescription").value, status: document.getElementById("sfStatus").value, notes: document.getElementById("sfNotes").value };
    saveCollectionItem("specs", item).then(() => { logActivity(id ? "Spec revised" : "Spec uploaded", item.name); closeModal(); });
  };
}
function openRevisionModal(specId) {
  const existing = specRevisions(specId);
  const nextNum = (existing[0] ? existing[0].revisionNumber : 0) + 1;
  document.getElementById("modalBody").innerHTML = `
    <h2>Add Revision ${nextNum}</h2>
    <label>Revision Date<input id="vfDate" type="date" /></label>
    <label>Notes<textarea id="vfNotes"></textarea></label>
    <label>Images<input id="vfImages" type="file" accept="image/*" multiple /></label>
    <label>PDFs / Attachments<input id="vfFiles" type="file" multiple /></label>
    <div style="margin-top:12px;"><button class="btn btn-primary" id="vfSave">Save Revision</button><button class="btn" id="vfCancel">Cancel</button></div>`;
  openModal();
  document.getElementById("vfCancel").onclick = closeModal;
  document.getElementById("vfSave").onclick = () => {
    const imageFiles = Array.from(document.getElementById("vfImages").files || []);
    const otherFiles = Array.from(document.getElementById("vfFiles").files || []);
    const uploadAll = (files) => Promise.all(files.map(f => safeUpload(`projects/${CURRENT_PROJECT_ID}/specs/${specId}/${uid("file")}_${f.name}`, f))).then(results => results.filter(Boolean));
    Promise.all([uploadAll(imageFiles), uploadAll(otherFiles)]).then(([images, files]) => {
      const item = { specId, revisionNumber: nextNum, date: document.getElementById("vfDate").value, notes: document.getElementById("vfNotes").value, images, files };
      saveCollectionItem("specRevisions", item).then(() => { logActivity("Spec revised", "Revision " + nextNum); closeModal(); });
    });
  };
}

/* ---------- Budget vs Actual ---------- */
function categoryTrades(cat) { return STATE.trades.filter(t => (cat.tradeIds || []).includes(t.id)); }
function categoryCommitted(cat) { return categoryTrades(cat).reduce((s, t) => s + (Number(t.contractValue) || 0), 0); }
function categoryInvoiced(cat) { const tradeIds = (cat.tradeIds || []); return STATE.invoices.filter(i => tradeIds.includes(i.tradeId)).reduce((s, i) => s + (Number(i.total) || 0), 0); }
function categoryPaid(cat) { const tradeIds = (cat.tradeIds || []); return STATE.invoices.filter(i => tradeIds.includes(i.tradeId)).reduce((s, i) => s + invoicePaid(i.id), 0); }
function categoryActual(cat) {
  const basis = STATE.settings.actualExpenseBasis || "Invoice";
  if (basis === "Paid") return categoryPaid(cat);
  if (basis === "Manual") return Number(cat.manualActual) || 0;
  return categoryInvoiced(cat);
}
function categoryVariance(cat) { return (Number(cat.budgetAmount) || 0) - categoryActual(cat); }
function categoryVariancePct(cat) { const b = Number(cat.budgetAmount) || 0; if (!b) return 0; return (categoryVariance(cat) / b) * 100; }
function categoryStatus(cat) { const v = categoryVariance(cat); if (!cat.budgetAmount) return "No Budget"; return v < 0 ? "Over Budget" : v === 0 ? "On Budget" : "Under Budget"; }

function renderBudget() {
  const tbody = document.getElementById("budgetTableBody"); const summary = document.getElementById("budgetSummaryMetrics");
  const basisSelect = document.getElementById("budgetBasisSelect");
  if (basisSelect) basisSelect.value = STATE.settings.actualExpenseBasis || "Invoice";
  if (!tbody) return;
  if (!STATE.budgetCategories.length) {
    tbody.innerHTML = `<tr><td colspan="9" class="muted">No budget categories yet. Click "+ Add Category" to create one (e.g. Framing, Plumbing, Site Rentals).</td></tr>`;
  } else {
    tbody.innerHTML = STATE.budgetCategories.map(cat => `<tr>
      <td>${escapeHtml(cat.name)}</td><td>${fmtMoney(cat.budgetAmount)}</td><td>${fmtMoney(categoryCommitted(cat))}</td>
      <td>${fmtMoney(categoryInvoiced(cat))}</td><td>${fmtMoney(categoryPaid(cat))}</td><td>${fmtMoney(categoryActual(cat))}</td>
      <td>${fmtMoney(categoryVariance(cat))}</td><td>${categoryVariancePct(cat).toFixed(1)}%</td><td>${categoryStatus(cat)}</td>
    </tr>`).join("");
  }
  const totalBudget = STATE.budgetCategories.reduce((s, c) => s + (Number(c.budgetAmount) || 0), 0);
  const totalCommitted = STATE.budgetCategories.reduce((s, c) => s + categoryCommitted(c), 0);
  const totalActual = STATE.budgetCategories.reduce((s, c) => s + categoryActual(c), 0);
  summary.innerHTML = `
    <div class="card metric-card"><div class="metric-label">Total Project Budget</div><div class="metric-value">${fmtMoney(totalBudget)}</div></div>
    <div class="card metric-card"><div class="metric-label">Total Committed</div><div class="metric-value">${fmtMoney(totalCommitted)}</div></div>
    <div class="card metric-card"><div class="metric-label">Total Actual Expense</div><div class="metric-value">${fmtMoney(totalActual)}</div></div>
    <div class="card metric-card"><div class="metric-label">Remaining Budget</div><div class="metric-value ${totalBudget - totalActual < 0 ? "red" : "green"}">${fmtMoney(totalBudget - totalActual)}</div></div>
    <div class="card metric-card"><div class="metric-label">Project Variance</div><div class="metric-value">${fmtMoney(totalBudget - totalActual)}</div></div>`;
}
function openBudgetCategoryModal(id) {
  const cat = id ? STATE.budgetCategories.find(x => x.id === id) : { id: null, name: "", budgetAmount: 0, manualActual: 0, tradeIds: [] };
  const tradeChecks = STATE.trades.map(t => `<label class="checkline"><input type="checkbox" value="${t.id}" ${((cat.tradeIds || []).includes(t.id)) ? "checked" : ""}/> ${escapeHtml(t.name)}</label>`).join("");
  document.getElementById("modalBody").innerHTML = `
    <h2>${id ? "Edit" : "Add"} Budget Category</h2>
    <label>Category Name<input id="bfName" value="${escapeAttr(cat.name)}" /></label>
    <label>Budget Amount<input id="bfBudget" type="number" step="0.01" value="${cat.budgetAmount || 0}" /></label>
    <label>Manually Entered Actual (used only when basis = Manual)<input id="bfManual" type="number" step="0.01" value="${cat.manualActual || 0}" /></label>
    <label>Linked Trades<div class="checklist">${tradeChecks || '<span class="muted">No trades yet.</span>'}</div></label>
    <div style="margin-top:12px;"><button class="btn btn-primary" id="bfSave">Save</button>${id ? '<button class="btn" id="bfDelete">Delete</button>' : ""}<button class="btn" id="bfCancel">Cancel</button></div>`;
  openModal();
  document.getElementById("bfCancel").onclick = closeModal;
  if (id) document.getElementById("bfDelete").onclick = () => { deleteCollectionItem("budgetCategories", id); closeModal(); };
  document.getElementById("bfSave").onclick = () => {
    const tradeIds = Array.from(document.querySelectorAll("#modalBody .checklist input:checked")).map(c => c.value);
    const item = { id: cat.id, name: document.getElementById("bfName").value.trim() || "Untitled Category", budgetAmount: Number(document.getElementById("bfBudget").value) || 0, manualActual: Number(document.getElementById("bfManual").value) || 0, tradeIds };
    saveCollectionItem("budgetCategories", item).then(() => { logActivity(id ? "Budget changed" : "Budget changed", item.name); closeModal(); });
  };
}

/* ---------- Financials ---------- */
function financialTotals() {
  const totalBudget = STATE.budgetCategories.reduce((s, c) => s + (Number(c.budgetAmount) || 0), 0);
  const totalTradeContracts = STATE.trades.reduce((s, t) => s + (Number(t.contractValue) || 0), 0);
  const totalSiteRentals = STATE.siteRentals.reduce((s, r) => s + (Number(r.cost) || 0), 0);
  const invoiced = STATE.invoices.reduce((s, i) => s + (Number(i.total) || 0), 0) + STATE.siteRentals.reduce((s, r) => s + (Number(r.invoiced) || 0), 0);
  const paid = STATE.invoices.reduce((s, i) => s + invoicePaid(i.id), 0) + STATE.siteRentals.reduce((s, r) => s + (Number(r.paid) || 0), 0);
  const totalActual = STATE.budgetCategories.reduce((s, c) => s + categoryActual(c), 0);
  return {
    totalBudget, totalTradeContracts, totalSiteRentals, committed: totalTradeContracts + totalSiteRentals,
    invoiced, paid, outstanding: invoiced - paid, totalActual, remaining: totalBudget - totalActual,
  };
}
function renderFinancials() {
  const el = document.getElementById("financialSummaryGrid"); if (!el) return;
  const t = financialTotals();
  const rows = [
    ["Total Project Budget", t.totalBudget], ["Total Trade Contracts", t.totalTradeContracts], ["Total Site Rentals", t.totalSiteRentals],
    ["Total Committed Cost", t.committed], ["Total Invoiced", t.invoiced], ["Total Paid", t.paid], ["Total Outstanding", t.outstanding],
    ["Total Actual Expense", t.totalActual], ["Remaining Budget", t.remaining], ["Project Variance", t.remaining],
  ];
  el.innerHTML = rows.map(([label, val]) => `<div class="card metric-card"><div class="metric-label">${label}</div><div class="metric-value">${fmtMoney(val)}</div></div>`).join("");
}

/* ---------- Documents ---------- */
function renderDocuments() {
  const tbody = document.getElementById("documentsTableBody"); const sel = document.getElementById("docCategorySelect");
  if (sel && !sel.options.length) sel.innerHTML = DOCUMENT_CATEGORIES.map(c => `<option>${c}</option>`).join("");
  if (!tbody) return;
  document.getElementById("documentsEmpty").classList.toggle("hidden", STATE.documents.length > 0);
  tbody.innerHTML = STATE.documents.map(d => `<tr>
      <td><a href="${escapeAttr(d.fileUrl)}" target="_blank">${escapeHtml(d.name)}</a></td><td>${escapeHtml(d.category)}</td>
      <td>${d.uploadedAt ? new Date(d.uploadedAt).toLocaleDateString() : ""}</td>
      <td class="row-actions"><button data-delete-doc="${d.id}">Delete</button></td></tr>`).join("");
  tbody.querySelectorAll("[data-delete-doc]").forEach(b => b.onclick = () => { if (confirm("Delete this document?")) deleteCollectionItem("documents", b.dataset.deleteDoc); });
}
function uploadDocument(file) {
  if (!file) return;
  const category = document.getElementById("docCategorySelect").value || "Other";
  safeUpload(`projects/${CURRENT_PROJECT_ID}/documents/${uid("doc")}_${file.name}`, file).then(result => {
    if (!result) return; // safeUpload already warned; nothing meaningful to save without the file itself
    saveCollectionItem("documents", { name: result.name, category, fileUrl: result.url, uploadedBy: (CURRENT_USER && CURRENT_USER.email) || "Client", uploadedAt: Date.now() })
      .then(() => logActivity("Document uploaded", result.name));
  });
}

/* ---------- Project Team ---------- */
function renderTeam() {
  const tbody = document.getElementById("teamTableBody"); if (!tbody) return;
  tbody.innerHTML = STATE.team.map(m => `<tr><td>${escapeHtml(m.name)}</td><td>${escapeHtml(m.role)}</td><td>${escapeHtml(m.company || "")}</td><td>${escapeHtml(m.email || "")}</td><td>${escapeHtml(m.phone || "")}</td>
    <td class="row-actions"><button data-edit-team="${m.id}">Edit</button><button data-delete-team="${m.id}">Delete</button></td></tr>`).join("") || `<tr><td colspan="6" class="muted">No team members yet.</td></tr>`;
  tbody.querySelectorAll("[data-edit-team]").forEach(b => b.onclick = () => openTeamModal(b.dataset.editTeam));
  tbody.querySelectorAll("[data-delete-team]").forEach(b => b.onclick = () => { if (confirm("Remove this team member?")) deleteCollectionItem("team", b.dataset.deleteTeam); });
}
function openTeamModal(id) {
  const m = id ? STATE.team.find(x => x.id === id) : { id: null, name: "", role: PROJECT_TEAM_ROLES[0], company: "", email: "", phone: "", responsibility: "", notes: "" };
  document.getElementById("modalBody").innerHTML = `
    <h2>${id ? "Edit" : "Add"} Team Member</h2>
    <label>Name<input id="tmName" value="${escapeAttr(m.name)}" /></label>
    <label>Role<select id="tmRole">${PROJECT_TEAM_ROLES.map(r => `<option ${r === m.role ? "selected" : ""}>${r}</option>`).join("")}</select></label>
    <label>Company<input id="tmCompany" value="${escapeAttr(m.company || "")}" /></label>
    <label>Email<input id="tmEmail" value="${escapeAttr(m.email || "")}" /></label>
    <label>Phone<input id="tmPhone" value="${escapeAttr(m.phone || "")}" /></label>
    <label>Responsibility<input id="tmResponsibility" value="${escapeAttr(m.responsibility || "")}" /></label>
    <label>Notes<textarea id="tmNotes">${escapeHtml(m.notes || "")}</textarea></label>
    <div style="margin-top:12px;"><button class="btn btn-primary" id="tmSave">Save</button><button class="btn" id="tmCancel">Cancel</button></div>`;
  openModal();
  document.getElementById("tmCancel").onclick = closeModal;
  document.getElementById("tmSave").onclick = () => {
    const item = { id: m.id, name: document.getElementById("tmName").value.trim() || "Unnamed", role: document.getElementById("tmRole").value,
      company: document.getElementById("tmCompany").value, email: document.getElementById("tmEmail").value, phone: document.getElementById("tmPhone").value,
      responsibility: document.getElementById("tmResponsibility").value, notes: document.getElementById("tmNotes").value };
    saveCollectionItem("team", item).then(() => closeModal());
  };
}

/* ---------- Activity (5 per page) ---------- */
function renderActivity() {
  const list = document.getElementById("activityList"); const label = document.getElementById("activityPageLabel");
  if (!list) return;
  const perPage = 5;
  const totalPages = Math.max(1, Math.ceil(STATE.activity.length / perPage));
  if (STATE.activityPage > totalPages) STATE.activityPage = totalPages;
  if (STATE.activityPage < 1) STATE.activityPage = 1;
  const start = (STATE.activityPage - 1) * perPage;
  const slice = STATE.activity.slice(start, start + perPage);
  list.innerHTML = slice.map(a => `<div class="activity-row">
    <div class="activity-date">${a.ts ? new Date(a.ts).toLocaleString() : ""}</div>
    <div><strong>${escapeHtml(a.user || "")}</strong> — ${escapeHtml(a.action || "")}<div class="muted">${escapeHtml(a.description || "")}</div></div>
  </div>`).join("") || `<p class="muted">No activity yet.</p>`;
  label.textContent = `Page ${STATE.activityPage} of ${totalPages}`;
  document.getElementById("btnActivityPrev").disabled = STATE.activityPage <= 1;
  document.getElementById("btnActivityNext").disabled = STATE.activityPage >= totalPages;
}

/* ---------- Settings panel ---------- */
function renderSettingsPanel() {
  const cur = document.getElementById("setCurrency"); if (cur) cur.value = STATE.settings.currency || "USD";
  const taxLabel = document.getElementById("setTaxLabel"); if (taxLabel) taxLabel.value = STATE.settings.taxLabel || "Tax";
  const taxRate = document.getElementById("setTaxRate"); if (taxRate) taxRate.value = STATE.settings.taxRate || 0;
}

/* ---------- Duplicate project modal ---------- */
function openDuplicateModal(sourceId) {
  const src = PROJECT_REGISTRY[sourceId];
  document.getElementById("modalBody").innerHTML = `
    <h2>Duplicate "${escapeHtml(src.name)}"</h2>
    <label>New Project Name<input id="dupName" value="${escapeAttr(src.name)} (Copy)" /></label>
    <div class="checklist">
      <label class="checkline"><input type="checkbox" id="dupMilestones" checked /> Milestone structure</label>
      <label class="checkline"><input type="checkbox" id="dupTrades" checked /> Trade structure</label>
      <label class="checkline"><input type="checkbox" id="dupBudget" checked /> Budget categories</label>
      <label class="checkline"><input type="checkbox" id="dupTeam" checked /> Project team structure</label>
    </div>
    <p class="muted">Invoices, payments, actual expenses, change orders, and documents are never copied.</p>
    <div style="margin-top:12px;"><button class="btn btn-primary" id="dupGo">Duplicate</button><button class="btn" id="dupCancel">Cancel</button></div>`;
  openModal();
  document.getElementById("dupCancel").onclick = closeModal;
  document.getElementById("dupGo").onclick = () => {
    duplicateProject(sourceId, document.getElementById("dupName").value, {
      milestones: document.getElementById("dupMilestones").checked, trades: document.getElementById("dupTrades").checked,
      budget: document.getElementById("dupBudget").checked, team: document.getElementById("dupTeam").checked,
    });
    closeModal();
  };
}

/* ---------- Modal / lightbox plumbing ---------- */
function openModal() { document.getElementById("modalOverlay").classList.add("show"); }
function closeModal() { document.getElementById("modalOverlay").classList.remove("show"); document.getElementById("modalBody").innerHTML = ""; }
function openLightbox(images, index) { STATE.lightbox = { images, index }; renderLightbox(); document.getElementById("lightboxOverlay").classList.add("show"); }
function closeLightbox() { document.getElementById("lightboxOverlay").classList.remove("show"); }
function renderLightbox() { document.getElementById("lightboxImg").src = STATE.lightbox.images[STATE.lightbox.index] || ""; }
function lightboxNav(delta) { const n = STATE.lightbox.images.length; STATE.lightbox.index = (STATE.lightbox.index + delta + n) % n; renderLightbox(); }

/* ---------- CSV / JSON export ---------- */
function toCSV(rows) { return rows.map(r => r.map(c => `"${String(c == null ? "" : c).replace(/"/g, '""')}"`).join(",")).join("\n"); }
function downloadFile(filename, content, mime) {
  const blob = new Blob([content], { type: mime }); const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url);
}
function exportCSV() {
  const rows = [["Type", "Name", "Start", "Finish", "Duration", "Status", "Budget", "Contract Value"]];
  STATE.milestones.forEach(m => { const s = computeSchedule()[m.id] || {}; rows.push(["Milestone", m.name, toISO(s.start), toISO(s.finish), m.duration, m.status, "", ""]); });
  STATE.trades.forEach(t => rows.push(["Trade", t.name, "", "", "", t.status, "", t.contractValue]));
  STATE.budgetCategories.forEach(c => rows.push(["Budget Category", c.name, "", "", "", "", c.budgetAmount, ""]));
  downloadFile((STATE.settings.title || "project") + "-export.csv", toCSV(rows), "text/csv");
}
function exportJSON() { downloadFile((STATE.settings.title || "project") + "-export.json", JSON.stringify(STATE, null, 2), "application/json"); }
function importCSVFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    const lines = reader.result.split(/\r?\n/).filter(Boolean);
    lines.slice(1).forEach(line => {
      const cols = line.match(/(".*?"|[^,]+)/g) || [];
      const clean = cols.map(c => c.replace(/^"|"$/g, "").replace(/""/g, '"'));
      const [type, name, start, finish, duration, status, budget, contractValue] = clean;
      if (type === "Milestone") saveCollectionItem("milestones", { name, duration: Number(duration) || 1, status: status || "Not Started", progress: 0 });
      if (type === "Trade") saveCollectionItem("trades", { name, status: status || "Active", contractValue: Number(contractValue) || 0, milestoneIds: [] });
      if (type === "Budget Category") saveCollectionItem("budgetCategories", { name, budgetAmount: Number(budget) || 0, manualActual: 0, tradeIds: [] });
    });
  };
  reader.readAsText(file);
}

/* ---------- Auth ---------- */
function openLoginModal() { document.getElementById("loginModalOverlay").classList.add("show"); }
function closeLoginModal() { document.getElementById("loginModalOverlay").classList.remove("show"); }
function handleLogin() {
  const email = document.getElementById("loginEmail").value, pw = document.getElementById("loginPassword").value;
  auth.signInWithEmailAndPassword(email, pw).then(() => closeLoginModal()).catch(err => alert(err.message));
}
function handleLogout() { auth.signOut(); }
function initAuth() {
  if (typeof auth === "undefined") { applyRoleUI(); return; }
  auth.onAuthStateChanged(user => { CURRENT_USER = user; USER_ROLE = user ? "admin" : "client"; applyRoleUI(); renderOnboardingGate(); renderAll(); });
}

/* ---------- Init ---------- */
function init() {
  renderStatusFilters();

  document.querySelectorAll(".nav-item").forEach(b => b.onclick = () => showSection(b.dataset.section));
  document.getElementById("btnCreateProject").onclick = () => createProject({
    name: document.getElementById("obName").value, number: document.getElementById("obNumber").value,
    address: document.getElementById("obAddress").value, city: document.getElementById("obCity").value,
    province: document.getElementById("obProvince").value, postal: document.getElementById("obPostal").value,
    type: document.getElementById("obType").value, status: document.getElementById("obStatus").value,
    start: document.getElementById("obStart").value, target: document.getElementById("obTarget").value,
    pm: document.getElementById("obPM").value, client: document.getElementById("obClient").value,
  });
  document.getElementById("btnNewProjectFromSettings").onclick = () => showSection("overview") || document.getElementById("sectionOnboarding").classList.remove("hidden");

  document.getElementById("btnSaveProjectInfo").onclick = saveProjectInfo;
  document.getElementById("btnSaveClient").onclick = saveClientInfo;
  document.getElementById("btnAddMilestone").onclick = () => openMilestoneModal(null);
  document.getElementById("btnAddMilestoneGantt").onclick = () => openMilestoneModal(null);
  document.getElementById("btnAddHoliday").onclick = () => {
    const date = document.getElementById("newHolidayDate").value, name = document.getElementById("newHolidayName").value;
    if (!date) return;
    const arr = (STATE.holidays || []).concat([{ date, name }]);
    ref("holidays").set(arr);
  };
  document.getElementById("btnAddTrade").onclick = () => openTradeModal(null);
  document.getElementById("btnAddSpec").onclick = () => openSpecModal(null);
  document.getElementById("btnAddBudgetCategory").onclick = () => openBudgetCategoryModal(null);
  document.getElementById("budgetBasisSelect").onchange = (e) => ref("settings/actualExpenseBasis").set(e.target.value).then(() => logActivity("Budget changed", "Actual Expense Basis → " + e.target.value));
  document.getElementById("btnAddInvoice").onclick = () => openInvoiceModal(null);
  document.getElementById("btnAddChangeOrder").onclick = () => openChangeOrderModal(null);
  document.getElementById("btnAddSiteRental").onclick = () => openSiteRentalModal(null);
  document.getElementById("btnUploadDocument").onclick = () => document.getElementById("documentFileInput").click();
  document.getElementById("documentFileInput").onchange = (e) => { if (e.target.files[0]) uploadDocument(e.target.files[0]); e.target.value = ""; };
  document.getElementById("btnAddTeamMember").onclick = () => openTeamModal(null);
  document.getElementById("btnActivityPrev").onclick = () => { STATE.activityPage--; renderActivity(); };
  document.getElementById("btnActivityNext").onclick = () => { STATE.activityPage++; renderActivity(); };
  document.getElementById("btnExportCSV").onclick = exportCSV;
  document.getElementById("btnExportJSON").onclick = exportJSON;
  document.getElementById("btnImportCSV").onclick = () => document.getElementById("csvFileInput").click();
  document.getElementById("csvFileInput").onchange = (e) => { if (e.target.files[0]) importCSVFile(e.target.files[0]); e.target.value = ""; };
  document.getElementById("btnSaveFinSettings").onclick = () => {
    ref("settings").update({ currency: document.getElementById("setCurrency").value, taxLabel: document.getElementById("setTaxLabel").value, taxRate: Number(document.getElementById("setTaxRate").value) || 0 });
  };

  const switcherEl = document.getElementById("projectSwitcher"); if (switcherEl) switcherEl.onchange = (e) => switchProject(e.target.value);

  document.getElementById("btnLogin").onclick = openLoginModal;
  document.getElementById("btnCancelLogin").onclick = closeLoginModal;
  document.getElementById("btnSubmitLogin").onclick = handleLogin;
  document.getElementById("btnLogout").onclick = handleLogout;
  document.getElementById("modalOverlay").onclick = (e) => { if (e.target.id === "modalOverlay") closeModal(); };
  document.getElementById("btnCloseLightbox").onclick = closeLightbox;
  document.getElementById("btnLightboxPrev").onclick = () => lightboxNav(-1);
  document.getElementById("btnLightboxNext").onclick = () => lightboxNav(1);
  document.getElementById("lightboxOverlay").onclick = (e) => { if (e.target.id === "lightboxOverlay") closeLightbox(); };

  // "Add Payment" button lives inside Payments section but there's no
  // static button in the HTML shell above the table — add one dynamically.
  const paymentsCard = document.querySelector("#sectionPayments .card-header");
  if (paymentsCard && !document.getElementById("btnAddPayment")) {
    const btn = document.createElement("button"); btn.className = "btn btn-primary"; btn.id = "btnAddPayment"; btn.textContent = "+ Add Payment";
    paymentsCard.appendChild(btn); btn.onclick = openAddPaymentModal;
  }

  initAuth();
  listenProjectRegistry();
  renderOnboardingGate();
}

if (typeof window !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
}
