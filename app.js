/* ============================================================
   LIVE PROJECT SCHEDULE
   app.js
   ------------------------------------------------------------
   Data lives in schedule.json in the GitHub repo (see config.js).

   Clients: the page fetches /schedule.json from the deployed site
   and re-checks every SITE_CONFIG.pollSeconds, so open screens
   update by themselves after the admin publishes a change.

   Admin: logs in with a GitHub access token that can write to the
   repo. Every edit is committed to schedule.json through the GitHub
   API (auto-saved a moment after the last change); Vercel redeploys
   on that commit. Viewers have no token, so they cannot change
   anything -- GitHub itself enforces that.
   ============================================================ */

const CFG = SITE_CONFIG;
const TOKEN_KEY = "gh_token_" + CFG.owner + "_" + CFG.repo;
const DRAFT_KEY = "schedule_draft_" + CFG.owner + "_" + CFG.repo;

const MILESTONE_STATUSES = ["Not Started", "In Progress", "Complete", "Delayed", "On Hold", "Cancelled"];
const EMPTY_DATA = {
  project: { title: "", address: "", client: "", projectManager: "", start: "", targetCompletion: "", description: "" },
  holidays: [], milestones: [], updatedAt: null, updatedBy: "",
};

let DATA = clone(EMPTY_DATA);
let LOADED = false;
let ROLE = "viewer";            // "viewer" | "admin"
let TOKEN = null, SHA = null, ADMIN_LOGIN = "";
const UI = { statusFilter: "All", zoom: "fit", previewAsClient: false, live: null };
const SAVE = { dirty: false, inFlight: false, timer: null, error: null, lastSavedAt: null, pending: [] };

/* ---------- Utilities ---------- */
function clone(o) { return JSON.parse(JSON.stringify(o)); }
function uid(prefix) { return (prefix || "id") + "_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8); }
function escapeHtml(s) { return (s == null ? "" : String(s)).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
const escapeAttr = escapeHtml;
function storageGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function storageSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
function storageDel(k) { try { localStorage.removeItem(k); } catch (e) {} }
function fmtPct(n) { return Math.round(Number(n) || 0) + "%"; }
function parseISO(s) { if (!s) return null; const [y, m, d] = String(s).split("-").map(Number); if (!y) return null; return new Date(y, (m || 1) - 1, d || 1); }
function toISO(d) { if (!d) return ""; return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
function fmtDateShort(d) { return d ? d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "—"; }
function fmtDateLong(d) { return d ? d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—"; }
function timeAgo(iso) {
  if (!iso) return "";
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return Math.round(s / 60) + " min ago";
  if (s < 86400) return Math.round(s / 3600) + " hr ago";
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg; el.classList.add("show");
  clearTimeout(toast._t); toast._t = setTimeout(() => el.classList.remove("show"), 3500);
}
function normalize(d) {
  const out = Object.assign(clone(EMPTY_DATA), d || {});
  out.project = Object.assign(clone(EMPTY_DATA.project), (d && d.project) || {});
  out.holidays = Array.isArray(out.holidays) ? out.holidays.filter(h => h && h.date) : [];
  out.milestones = (Array.isArray(out.milestones) ? out.milestones : []).filter(Boolean).map((m, i) => Object.assign({
    id: m.id || uid("m"), name: "Untitled", duration: 1, status: "Not Started", progress: 0, order: i,
  }, m));
  return out;
}

/* ---------- Business-day engine (Mon–Fri, minus holidays) ---------- */
function isHoliday(d) { const iso = toISO(d); return DATA.holidays.some(h => h.date === iso); }
function isBusinessDay(d) { const day = d.getDay(); return day !== 0 && day !== 6 && !isHoliday(d); }
function addBusinessDays(start, days) {
  let d = new Date(start.getTime());
  let remaining = Math.max(0, days - 1);
  while (!isBusinessDay(d)) d.setDate(d.getDate() + 1);
  while (remaining > 0) { d.setDate(d.getDate() + 1); if (isBusinessDay(d)) remaining--; }
  return d;
}
function subtractBusinessDays(finish, days) {
  let d = new Date(finish.getTime());
  while (!isBusinessDay(d)) d.setDate(d.getDate() - 1);
  let remaining = Math.max(0, days - 1);
  while (remaining > 0) { d.setDate(d.getDate() - 1); if (isBusinessDay(d)) remaining--; }
  return d;
}
function calculateBusinessDays(start, finish) {
  if (!start || !finish) return 0;
  let count = 0; const d = new Date(start.getTime());
  while (d <= finish) { if (isBusinessDay(d)) count++; d.setDate(d.getDate() + 1); }
  return Math.max(1, count);
}

/* Start/finish for every milestone: a manual start date wins; otherwise
   it follows its predecessor (next business day after it finishes);
   otherwise it starts on the project start date. */
function computeSchedule() {
  const byId = {}; DATA.milestones.forEach(m => byId[m.id] = m);
  const out = {}, visiting = new Set();
  const projectStart = () => parseISO(DATA.project.start) || new Date(new Date().setHours(0, 0, 0, 0));
  function resolve(id) {
    if (out[id]) return out[id];
    const m = byId[id]; if (!m) return null;
    if (visiting.has(id)) return out[id] = { start: projectStart(), finish: projectStart() };
    visiting.add(id);
    let start;
    if (m.manualStart) start = parseISO(m.manualStart);
    else if (m.dependsOn && byId[m.dependsOn]) start = addBusinessDays(resolve(m.dependsOn).finish, 2);
    else start = projectStart();
    const finish = addBusinessDays(start, m.duration || 1);
    out[id] = { start: addBusinessDays(start, 1), finish };
    visiting.delete(id);
    return out[id];
  }
  DATA.milestones.forEach(m => resolve(m.id));
  return out;
}
function sortedMilestones() {
  return DATA.milestones.slice().sort((a, b) => (a.order == null ? 1e9 : a.order) - (b.order == null ? 1e9 : b.order));
}
function projectedCompletion(schedule) {
  let latest = null;
  Object.values(schedule).forEach(s => { if (!latest || s.finish > latest) latest = s.finish; });
  return latest;
}
function completionPct() {
  const list = DATA.milestones.filter(m => m.status !== "Cancelled");
  if (!list.length) return 0;
  return list.reduce((s, m) => s + (Number(m.progress) || 0), 0) / list.length;
}
function statusColor(status) {
  return { "Not Started": "gray", "In Progress": "blue", "Complete": "green", "Delayed": "red", "On Hold": "amber", "Cancelled": "gray" }[status] || "gray";
}

/* ============================================================
   RENDERING
   ============================================================ */
function render() {
  applyRole();
  renderHeader();
  renderMetrics();
  renderChips();
  renderGantt();
  renderGlance();
  renderList();
  renderFooter();
  renderSaveStatus();
}

function applyRole() {
  const adminView = ROLE === "admin" && !UI.previewAsClient;
  document.body.classList.toggle("is-admin", adminView);
  document.body.classList.toggle("is-viewer", !adminView);
  document.body.classList.toggle("previewing", ROLE === "admin" && UI.previewAsClient);
  document.getElementById("btnAdmin").style.display = ROLE === "admin" ? "none" : "";
}

function renderHeader() {
  const p = DATA.project;
  const title = p.title || "Project Schedule";
  document.title = title + " — Schedule";
  document.getElementById("projTitle").textContent = title;
  document.getElementById("projSub").textContent = [p.address, p.client && "Client: " + p.client].filter(Boolean).join(" · ");
  const intro = document.getElementById("projectIntro");
  intro.classList.toggle("hidden", !p.description);
  document.getElementById("introTitle").textContent = title;
  document.getElementById("introDescription").textContent = p.description || "";
}

function renderMetrics() {
  const el = document.getElementById("metrics");
  const schedule = computeSchedule();
  if (!DATA.milestones.length) { el.innerHTML = ""; return; }
  const starts = Object.values(schedule).map(s => s.start);
  const first = starts.length ? new Date(Math.min(...starts)) : null;
  const projected = projectedCompletion(schedule);
  const target = parseISO(DATA.project.targetCompletion);
  const done = DATA.milestones.filter(m => m.status === "Complete").length;
  const card = (label, value, cls, sub) => `<div class="card metric-card"><div class="metric-label">${label}</div><div class="metric-value ${cls || ""}">${value}</div>${sub ? `<div class="metric-sub">${sub}</div>` : ""}</div>`;
  let varianceCard = "";
  if (target && projected) {
    const days = Math.round((projected - target) / 86400000);
    varianceCard = card("Vs. Target", days > 0 ? `${days} days late` : days < 0 ? `${-days} days early` : "On target", days > 0 ? "red" : "green", "Target " + fmtDateLong(target));
  }
  el.innerHTML = card("Overall Progress", fmtPct(completionPct()), "", `<div class="progress wide"><div style="width:${Math.min(100, completionPct())}%"></div></div>`) +
    card("Start", fmtDateLong(first)) + card("Projected Completion", fmtDateLong(projected)) + varianceCard +
    card("Milestones Complete", `${done} of ${DATA.milestones.length}`);
}

function renderChips() {
  const el = document.getElementById("scheduleChips");
  if (!DATA.milestones.length) { el.innerHTML = ""; return; }
  const zooms = ["fit", "day", "week", "month"];
  el.innerHTML = ["All", ...MILESTONE_STATUSES].map(s => `<button class="chip ${UI.statusFilter === s ? "active" : ""}" data-filter="${s}">${s}</button>`).join("") +
    `<span class="chip-spacer"></span>` +
    zooms.map(z => `<button class="chip ${UI.zoom === z ? "active" : ""}" data-zoom="${z}">${z[0].toUpperCase() + z.slice(1)}</button>`).join("");
  el.querySelectorAll("[data-filter]").forEach(b => b.onclick = () => { UI.statusFilter = b.dataset.filter; render(); });
  el.querySelectorAll("[data-zoom]").forEach(b => b.onclick = () => { UI.zoom = b.dataset.zoom; render(); });
}

const GANTT_PX = { day: 22, week: 8, month: 3 };
function renderGantt() {
  const body = document.getElementById("ganttBody"), months = document.getElementById("ganttMonths");
  const scroll = document.querySelector(".gantt-scroll");
  body.innerHTML = ""; months.innerHTML = "";
  const has = DATA.milestones.length > 0;
  document.getElementById("ganttEmpty").classList.toggle("hidden", has || !LOADED);
  scroll.classList.toggle("hidden", !has);
  renderLegend(has);
  if (!has) return;

  const schedule = computeSchedule();
  const list = sortedMilestones().filter(m => UI.statusFilter === "All" || m.status === UI.statusFilter);
  const starts = Object.values(schedule).map(s => s.start);
  let t0 = new Date(Math.min(...starts));
  const ps = parseISO(DATA.project.start); if (ps && ps < t0) t0 = ps;
  t0 = new Date(t0.getFullYear(), t0.getMonth(), t0.getDate() - 3);
  const target = parseISO(DATA.project.targetCompletion);
  const lastFinish = projectedCompletion(schedule);
  const spanEnd = new Date(Math.max(lastFinish.getTime(), target ? target.getTime() : 0));
  const totalDays = Math.max(30, Math.round((spanEnd - t0) / 86400000) + 10);
  const LABEL_W = window.innerWidth < 640 ? 140 : 260;
  const PX = UI.zoom === "fit" ? (scroll.clientWidth ? Math.max(1.5, (scroll.clientWidth - LABEL_W - 2) / totalDays) : 6) : GANTT_PX[UI.zoom];
  const off = d => Math.round((d - t0) / 86400000);

  months.style.width = (totalDays * PX) + "px"; months.style.marginLeft = LABEL_W + "px";
  for (let c = new Date(t0.getFullYear(), t0.getMonth(), 1); c <= spanEnd; c.setMonth(c.getMonth() + 1)) {
    const m = document.createElement("div"); m.className = "gantt-month";
    m.style.left = (Math.max(0, off(c)) * PX) + "px";
    const w = 30 * PX;
    m.textContent = c.toLocaleDateString(undefined, w >= 64 ? { month: "short", year: "numeric" } : w >= 30 ? { month: "short" } : { month: "narrow" });
    months.appendChild(m);
  }
  body.style.width = (LABEL_W + totalDays * PX) + "px";

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const todayOff = off(today);
  list.forEach(m => {
    const s = schedule[m.id]; if (!s) return;
    const row = document.createElement("div"); row.className = "gantt-row";
    const label = document.createElement("div"); label.className = "gantt-label";
    label.style.width = label.style.minWidth = LABEL_W + "px";
    label.innerHTML = `<span class="gname" title="${escapeAttr(m.name)}">${escapeHtml(m.name)}</span><span class="gsub">${fmtDateShort(s.start)} – ${fmtDateShort(s.finish)} · ${m.progress || 0}%${m.trade ? " · " + escapeHtml(m.trade) : ""}</span>`;
    label.onclick = () => openMilestone(m.id);
    const lane = document.createElement("div"); lane.className = "gantt-lane"; lane.style.width = (totalDays * PX) + "px";
    if (todayOff >= 0 && todayOff <= totalDays) { const t = document.createElement("div"); t.className = "gantt-today"; t.style.left = (todayOff * PX) + "px"; lane.appendChild(t); }
    if (target) { const t = document.createElement("div"); t.className = "gantt-target"; t.style.left = (off(target) * PX) + "px"; lane.appendChild(t); }
    const bar = document.createElement("div"); bar.className = "gantt-bar bar-" + statusColor(m.status);
    bar.style.left = (off(s.start) * PX) + "px";
    bar.style.width = Math.max((off(s.finish) - off(s.start) + 1) * PX - 2, 6) + "px";
    bar.title = `${m.name}\n${fmtDateLong(s.start)} – ${fmtDateLong(s.finish)}\n${m.status} · ${m.progress || 0}%`;
    bar.onclick = () => openMilestone(m.id);
    const fill = document.createElement("div"); fill.className = "gantt-bar-fill"; fill.style.width = Math.min(100, m.progress || 0) + "%";
    bar.appendChild(fill); lane.appendChild(bar);
    row.appendChild(label); row.appendChild(lane); body.appendChild(row);
  });
  if (!list.length) body.innerHTML = `<p class="muted" style="padding:14px;">No milestones with status "${escapeHtml(UI.statusFilter)}".</p>`;
}
function renderLegend(has) {
  const el = document.getElementById("ganttLegend");
  if (!has) { el.innerHTML = ""; return; }
  el.innerHTML = [["Not Started", "gray"], ["In Progress", "blue"], ["Complete", "green"], ["Delayed", "red"], ["On Hold", "amber"]]
    .map(([l, c]) => `<span><span class="status-dot dot-${c}"></span>${l}</span>`).join("") +
    `<span><span class="legend-line today"></span>Today</span>` +
    (DATA.project.targetCompletion ? `<span><span class="legend-line target"></span>Target completion</span>` : "");
}

function renderGlance() {
  const card = document.getElementById("glanceCard"), el = document.getElementById("glance");
  card.classList.toggle("hidden", !DATA.milestones.length);
  if (!DATA.milestones.length) return;
  const schedule = computeSchedule();
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const open = sortedMilestones().filter(m => m.status !== "Complete" && m.status !== "Cancelled").map(m => Object.assign({ m }, schedule[m.id]));
  const now = open.filter(r => r.start <= today);
  const next = open.filter(r => r.start > today).sort((a, b) => a.start - b.start).slice(0, 5);
  const recent = sortedMilestones().filter(m => m.status === "Complete").map(m => Object.assign({ m }, schedule[m.id])).sort((a, b) => b.finish - a.finish).slice(0, 3);
  const item = r => `<div class="glance-row" data-open="${r.m.id}">
      <span class="status-dot dot-${statusColor(r.m.status)}"></span>
      <span class="glance-name">${escapeHtml(r.m.name)}</span>
      <span class="glance-dates">${fmtDateShort(r.start)} – ${fmtDateShort(r.finish)}</span>
    </div>`;
  el.innerHTML = `
    <div class="glance-col"><h3>In progress now</h3>${now.map(item).join("") || '<p class="muted">Nothing in progress.</p>'}</div>
    <div class="glance-col"><h3>Coming up next</h3>${next.map(item).join("") || '<p class="muted">Nothing else scheduled.</p>'}</div>
    <div class="glance-col"><h3>Recently completed</h3>${recent.map(item).join("") || '<p class="muted">Nothing completed yet.</p>'}</div>`;
  el.querySelectorAll("[data-open]").forEach(r => r.onclick = () => openMilestone(r.dataset.open));
}

function renderList() {
  const card = document.getElementById("listCard"), tbody = document.getElementById("milestoneRows");
  card.classList.toggle("hidden", !DATA.milestones.length);
  const schedule = computeSchedule();
  const list = sortedMilestones();
  tbody.innerHTML = list.map((m, i) => {
    const s = schedule[m.id] || {};
    return `<tr data-open="${m.id}">
      <td class="muted hide-sm">${i + 1}</td><td><strong>${escapeHtml(m.name)}</strong></td><td class="hide-sm">${escapeHtml(m.trade || "")}</td>
      <td>${fmtDateShort(s.start)}</td><td>${fmtDateShort(s.finish)}</td><td class="hide-sm">${m.duration || 1}d</td>
      <td><span class="status-dot dot-${statusColor(m.status)}"></span>${escapeHtml(m.status)}</td>
      <td class="nowrap"><span class="progress"><span style="width:${Math.min(100, m.progress || 0)}%"></span></span>${m.progress || 0}%</td>
      <td class="row-actions admin-only nowrap">
        <button data-move="${m.id}" data-dir="-1" title="Move up" ${i === 0 ? "disabled" : ""}>↑</button>
        <button data-move="${m.id}" data-dir="1" title="Move down" ${i === list.length - 1 ? "disabled" : ""}>↓</button>
        <button data-edit="${m.id}">Edit</button>
      </td>
    </tr>`;
  }).join("");
  tbody.querySelectorAll("tr[data-open]").forEach(tr => tr.onclick = (e) => { if (!e.target.closest(".row-actions")) openMilestone(tr.dataset.open); });
  tbody.querySelectorAll("[data-edit]").forEach(b => b.onclick = () => openMilestoneEditor(b.dataset.edit));
  tbody.querySelectorAll("[data-move]").forEach(b => b.onclick = () => moveMilestone(b.dataset.move, Number(b.dataset.dir)));
}

function renderFooter() {
  const el = document.getElementById("footer");
  el.textContent = DATA.updatedAt ? `Schedule last updated ${fmtDateLong(new Date(DATA.updatedAt))} at ${new Date(DATA.updatedAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}` : "";
}

function setLive(ok) {
  UI.live = ok;
  const pill = document.getElementById("livePill"), txt = document.getElementById("liveText");
  pill.classList.toggle("offline", !ok);
  if (ROLE === "admin") { txt.textContent = "Admin"; pill.classList.remove("offline"); pill.classList.add("admin"); return; }
  pill.classList.remove("admin");
  txt.textContent = ok ? "Live" + (DATA.updatedAt ? " · updated " + timeAgo(DATA.updatedAt) : "") : "Offline — retrying";
}

/* ---------- Milestone detail (everyone) ---------- */
function openMilestone(id) {
  if (ROLE === "admin" && !UI.previewAsClient) { openMilestoneEditor(id); return; }
  const m = DATA.milestones.find(x => x.id === id); if (!m) return;
  const s = computeSchedule()[id] || {};
  const dep = m.dependsOn ? DATA.milestones.find(x => x.id === m.dependsOn) : null;
  const row = (label, val) => val ? `<div class="detail-row"><span>${label}</span><strong>${val}</strong></div>` : "";
  openModal(`
    <h2>${escapeHtml(m.name)}</h2>
    <div class="detail-list">
      ${row("Status", `<span class="status-dot dot-${statusColor(m.status)}"></span>${escapeHtml(m.status)}`)}
      ${row("Start", fmtDateLong(s.start))}
      ${row("Finish", fmtDateLong(s.finish))}
      ${row("Duration", (m.duration || 1) + " working day" + ((m.duration || 1) === 1 ? "" : "s"))}
      ${row("Progress", `${m.progress || 0}%`)}
      ${row("Trade", escapeHtml(m.trade || ""))}
      ${row("Follows", dep ? escapeHtml(dep.name) : "")}
    </div>
    ${m.notes ? `<p class="detail-notes">${escapeHtml(m.notes)}</p>` : ""}
    <div class="modal-actions"><button class="btn" data-close>Close</button></div>`);
}

/* ---------- Modal plumbing ---------- */
function openModal(html, wide) {
  const b = document.getElementById("modalBody");
  b.innerHTML = html; b.classList.toggle("modal-wide", !!wide);
  document.getElementById("modalOverlay").classList.add("show");
  b.querySelectorAll("[data-close]").forEach(x => x.onclick = closeModal);
}
function closeModal() { document.getElementById("modalOverlay").classList.remove("show"); document.getElementById("modalBody").innerHTML = ""; }

/* ============================================================
   CLIENT SYNC — read the published schedule.json, re-check often
   ============================================================ */
async function loadPublished() {
  if (ROLE === "admin") return;
  try {
    const r = await fetch(CFG.dataPath + "?t=" + Date.now(), { cache: "no-store" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const d = normalize(await r.json());
    const changed = !LOADED || d.updatedAt !== DATA.updatedAt;
    DATA = d; LOADED = true;
    document.getElementById("loadError").classList.add("hidden");
    if (changed) render();
    setLive(true);
  } catch (e) {
    setLive(false);
    if (!LOADED) {
      const el = document.getElementById("loadError");
      el.innerHTML = `<strong>The schedule couldn't be loaded.</strong> <span class="muted">Check your connection — this page keeps retrying automatically.</span>`;
      el.classList.remove("hidden");
    }
  }
}

/* ============================================================
   ADMIN — GitHub-backed editing
   ============================================================ */
function gh(path, opts) {
  opts = opts || {};
  return fetch(`https://api.github.com/repos/${CFG.owner}/${CFG.repo}${path}`, Object.assign({ cache: "no-store" }, opts, {
    headers: Object.assign({ Accept: "application/vnd.github+json", Authorization: "Bearer " + TOKEN, "X-GitHub-Api-Version": "2022-11-28" }, opts.headers || {}),
  }));
}
async function ghError(r) {
  let msg = "GitHub error " + r.status;
  try { const j = await r.json(); if (j.message) msg += ": " + j.message; } catch (e) {}
  if (r.status === 401) msg = "GitHub didn't accept the access token (it may have expired). Log out and log in again with a new token.";
  if (r.status === 403 || r.status === 404) msg += " — make sure the token has Contents: Read and write access to " + CFG.owner + "/" + CFG.repo + ".";
  return new Error(msg);
}
function b64encode(str) {
  const bytes = new TextEncoder().encode(str); let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function b64decode(b64) { const bin = atob(String(b64).replace(/\s/g, "")); return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0))); }

async function fetchRemote() {
  const r = await gh(`/contents/${encodeURIComponent(CFG.dataPath)}?ref=${encodeURIComponent(CFG.branch)}`);
  if (r.status === 404) {
    const repo = await gh(""); // distinguish "file missing" from "no access"
    if (!repo.ok) throw await ghError(repo);
    return { data: null, sha: null };
  }
  if (!r.ok) throw await ghError(r);
  const j = await r.json();
  return { data: JSON.parse(b64decode(j.content)), sha: j.sha };
}
function putFile(content, message) {
  const body = { message, content: b64encode(content), branch: CFG.branch };
  if (SHA) body.sha = SHA;
  return gh(`/contents/${encodeURIComponent(CFG.dataPath)}`, { method: "PUT", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
}

async function adminLogin(token) {
  TOKEN = token.trim();
  const { data, sha } = await fetchRemote();
  try { const u = await fetch("https://api.github.com/user", { headers: { Authorization: "Bearer " + TOKEN } }); if (u.ok) ADMIN_LOGIN = (await u.json()).login || ""; } catch (e) {}
  SHA = sha; DATA = normalize(data); LOADED = true; ROLE = "admin";
  storageSet(TOKEN_KEY, TOKEN);
  document.getElementById("loadError").classList.add("hidden");
  // An edit that never reached GitHub (closed tab, lost connection) is kept
  // on this device -- offer it back if it is newer than what's published.
  const draftRaw = storageGet(DRAFT_KEY);
  if (draftRaw) {
    try {
      const draft = JSON.parse(draftRaw);
      if (draft.updatedAt && (!DATA.updatedAt || draft.updatedAt > DATA.updatedAt) && confirm("You have changes on this device that were never saved to the live site. Restore and save them now?")) {
        DATA = normalize(draft); markChanged("Restore unsaved changes");
      } else storageDel(DRAFT_KEY);
    } catch (e) { storageDel(DRAFT_KEY); }
  }
  setLive(true);
  render();
}
function adminLogout() {
  if ((SAVE.dirty || SAVE.inFlight) && !confirm("Some changes haven't finished saving. Log out anyway? (They stay on this device and you'll be offered them next time you log in.)")) return;
  storageDel(TOKEN_KEY);
  TOKEN = null; SHA = null; ROLE = "viewer"; UI.previewAsClient = false;
  clearTimeout(SAVE.timer); Object.assign(SAVE, { dirty: false, inFlight: false, error: null, pending: [] });
  LOADED = false; loadPublished(); render();
}

/* Every admin change goes through here: update the page immediately,
   keep a local backup, then save to GitHub shortly after the last edit
   (so a burst of edits becomes one save / one deploy). */
function markChanged(summary) {
  DATA.updatedAt = new Date().toISOString();
  DATA.updatedBy = ADMIN_LOGIN || "admin";
  SAVE.dirty = true; SAVE.error = null;
  if (summary) SAVE.pending.push(summary);
  storageSet(DRAFT_KEY, JSON.stringify(DATA));
  render();
  clearTimeout(SAVE.timer); SAVE.timer = setTimeout(publish, 1200);
}
async function publish() {
  if (ROLE !== "admin" || !SAVE.dirty) return;
  if (SAVE.inFlight) { clearTimeout(SAVE.timer); SAVE.timer = setTimeout(publish, 800); return; }
  SAVE.inFlight = true; SAVE.dirty = false;
  const summary = SAVE.pending.splice(0);
  renderSaveStatus();
  const content = JSON.stringify(DATA, null, 2) + "\n";
  const message = "Schedule update: " + (summary.length === 1 ? summary[0] : summary.length ? summary.length + " changes" : "edit");
  try {
    let r = await putFile(content, message);
    if (r.status === 409 || r.status === 422) {
      // File changed on GitHub since we loaded it (e.g. saved from another
      // tab). The admin's current screen is the intended state, so save it
      // on top of the latest version.
      SHA = (await fetchRemote()).sha;
      r = await putFile(content, message);
    }
    if (!r.ok) throw await ghError(r);
    SHA = (await r.json()).content.sha;
    SAVE.lastSavedAt = Date.now();
    if (!SAVE.dirty) storageDel(DRAFT_KEY);
  } catch (e) {
    SAVE.error = e.message || String(e); SAVE.dirty = true; SAVE.pending.unshift(...summary);
  }
  SAVE.inFlight = false;
  renderSaveStatus();
  if (SAVE.dirty && !SAVE.error) publish();
}
function renderSaveStatus() {
  const el = document.getElementById("saveStatus");
  if (ROLE !== "admin") { el.innerHTML = ""; return; }
  if (SAVE.error) {
    el.className = "save-status admin-only error";
    el.innerHTML = `Not saved <button class="btn btn-sm" id="btnRetrySave">Retry</button>`;
    el.title = SAVE.error;
    document.getElementById("btnRetrySave").onclick = () => { SAVE.error = null; publish(); };
    return;
  }
  el.title = "";
  if (SAVE.inFlight || SAVE.dirty) { el.className = "save-status admin-only saving"; el.textContent = "Saving…"; return; }
  if (SAVE.lastSavedAt) { el.className = "save-status admin-only saved"; el.textContent = "Saved ✓ live for clients in ~1 min"; return; }
  el.className = "save-status admin-only"; el.textContent = "All changes saved";
}

function openLoginModal() {
  openModal(`
    <h2>Admin Login</h2>
    <p class="muted">Paste your GitHub access token. It's stored only in this browser and is used to save the schedule to the <strong>${escapeHtml(CFG.owner)}/${escapeHtml(CFG.repo)}</strong> repository.</p>
    <label>GitHub access token<input type="password" id="loginToken" autocomplete="off" placeholder="github_pat_…" /></label>
    <details class="help"><summary>How do I get a token?</summary>
      <ol>
        <li>Open <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">GitHub → Settings → Fine-grained tokens → Generate new token</a>.</li>
        <li><strong>Resource owner:</strong> ${escapeHtml(CFG.owner)}. <strong>Repository access:</strong> Only select repositories → <em>${escapeHtml(CFG.repo)}</em>.</li>
        <li><strong>Permissions → Repository → Contents:</strong> Read and write.</li>
        <li>Generate, copy the token, and paste it here.</li>
      </ol>
    </details>
    <p class="red hidden" id="loginError"></p>
    <div class="modal-actions"><button class="btn btn-primary" id="btnDoLogin">Log In</button><button class="btn" data-close>Cancel</button></div>`);
  const go = async () => {
    const btn = document.getElementById("btnDoLogin"), err = document.getElementById("loginError");
    const val = document.getElementById("loginToken").value;
    if (!val.trim()) return;
    btn.disabled = true; btn.textContent = "Checking…"; err.classList.add("hidden");
    try { await adminLogin(val); closeModal(); toast("Logged in — changes save to the live site automatically"); }
    catch (e) { TOKEN = null; err.textContent = e.message; err.classList.remove("hidden"); btn.disabled = false; btn.textContent = "Log In"; }
  };
  document.getElementById("btnDoLogin").onclick = go;
  document.getElementById("loginToken").onkeydown = (e) => { if (e.key === "Enter") go(); };
  document.getElementById("loginToken").focus();
}

/* ---------- Admin editors ---------- */
function openMilestoneEditor(id) {
  if (ROLE !== "admin") return;
  const m = id ? DATA.milestones.find(x => x.id === id) : { id: null, name: "", trade: "", duration: 5, status: "Not Started", progress: 0, dependsOn: "", manualStart: "", notes: "" };
  if (!m) return;
  const deps = sortedMilestones().filter(x => x.id !== id).map(x => `<option value="${x.id}" ${m.dependsOn === x.id ? "selected" : ""}>${escapeHtml(x.name)}</option>`).join("");
  openModal(`
    <h2>${id ? "Edit" : "Add"} Milestone</h2>
    <label>Name<input id="mfName" value="${escapeAttr(m.name)}" /></label>
    <label>Trade<input id="mfTrade" value="${escapeAttr(m.trade || "")}" placeholder="e.g. Framing" /></label>
    <div class="form-grid two">
      <label>Start date<input id="mfStart" type="date" value="${escapeAttr(m.manualStart || "")}" /><small class="muted">Leave blank to follow the milestone below</small></label>
      <label>Starts after<select id="mfDepends"><option value="">— (project start)</option>${deps}</select></label>
      <label>Duration (working days)<input id="mfDuration" type="number" min="1" value="${m.duration || 1}" /></label>
      <label>Status<select id="mfStatus">${MILESTONE_STATUSES.map(s => `<option ${s === m.status ? "selected" : ""}>${s}</option>`).join("")}</select></label>
      <label>Progress %<input id="mfProgress" type="number" min="0" max="100" value="${m.progress || 0}" /></label>
    </div>
    <label>Notes (visible to clients)<textarea id="mfNotes">${escapeHtml(m.notes || "")}</textarea></label>
    <div class="modal-actions">
      <button class="btn btn-primary" id="mfSave">Save</button><button class="btn" data-close>Cancel</button>
      ${id ? '<span class="spacer"></span><button class="btn btn-danger" id="mfDelete">Delete</button>' : ""}
    </div>`);
  document.getElementById("mfName").focus();
  document.getElementById("mfStatus").onchange = (e) => { if (e.target.value === "Complete") document.getElementById("mfProgress").value = 100; };
  document.getElementById("mfSave").onclick = () => {
    const v = idx => document.getElementById(idx).value;
    const rec = {
      id: m.id || uid("m"), name: v("mfName").trim() || "Untitled milestone", trade: v("mfTrade").trim(),
      duration: Math.max(1, Math.round(Number(v("mfDuration")) || 1)), status: v("mfStatus"),
      progress: Math.max(0, Math.min(100, Math.round(Number(v("mfProgress")) || 0))), notes: v("mfNotes"),
      order: id ? m.order : DATA.milestones.reduce((mx, x) => Math.max(mx, (x.order || 0) + 1), 0),
    };
    if (v("mfStart")) rec.manualStart = v("mfStart");
    if (v("mfDepends")) rec.dependsOn = v("mfDepends");
    if (id) DATA.milestones = DATA.milestones.map(x => x.id === id ? rec : x); else DATA.milestones.push(rec);
    closeModal();
    markChanged((id ? "edit " : "add ") + rec.name);
  };
  if (id) document.getElementById("mfDelete").onclick = () => {
    if (!confirm(`Delete "${m.name}"?`)) return;
    // Milestones that followed this one keep their current dates.
    const before = computeSchedule();
    DATA.milestones = DATA.milestones.filter(x => x.id !== id);
    DATA.milestones.forEach(x => { if (x.dependsOn === id) { if (!x.manualStart) x.manualStart = toISO(before[x.id].start); delete x.dependsOn; } });
    closeModal();
    markChanged("delete " + m.name);
  };
}
function moveMilestone(id, dir) {
  const list = sortedMilestones(); const i = list.findIndex(m => m.id === id), j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  list.forEach((m, k) => { m.order = k; });
  markChanged("reorder milestones");
}
function openProjectEditor() {
  const p = DATA.project;
  const f = (key, label, type, ph) => `<label>${label}<input id="pf_${key}" type="${type || "text"}" value="${escapeAttr(p[key] || "")}" placeholder="${ph || ""}" /></label>`;
  openModal(`
    <h2>Project Details</h2>
    <div class="form-grid two">
      ${f("title", "Project name")}${f("address", "Address")}
      ${f("client", "Client")}${f("projectManager", "Project manager")}
      ${f("start", "Project start", "date")}${f("targetCompletion", "Target completion", "date")}
    </div>
    <label>Description shown to clients<textarea id="pf_description">${escapeHtml(p.description || "")}</textarea></label>
    <label>Holidays / non-working days <small class="muted">one per line: 2026-12-25 Christmas</small>
      <textarea id="pf_holidays" rows="5">${escapeHtml(DATA.holidays.map(h => h.date + (h.name ? " " + h.name : "")).join("\n"))}</textarea></label>
    <div class="modal-actions"><button class="btn btn-primary" id="pfSave">Save</button><button class="btn" data-close>Cancel</button></div>`);
  document.getElementById("pfSave").onclick = () => {
    ["title", "address", "client", "projectManager", "start", "targetCompletion", "description"].forEach(k => { DATA.project[k] = document.getElementById("pf_" + k).value.trim(); });
    const bad = [];
    DATA.holidays = document.getElementById("pf_holidays").value.split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(l => {
      const [first, ...rest] = l.split(/\s+/);
      const d = parseFlexibleDate(first, "mdy");
      if (!d) { bad.push(l); return null; }
      return { date: toISO(d), name: rest.join(" ") };
    }).filter(Boolean);
    if (bad.length) alert("These holiday lines weren't understood and were skipped:\n" + bad.join("\n"));
    closeModal();
    markChanged("project details");
  };
}

/* ---------- CSV export ---------- */
function toCSV(rows) { return rows.map(r => r.map(c => `"${String(c == null ? "" : c).replace(/"/g, '""')}"`).join(",")).join("\r\n"); }
function downloadFile(name, content, mime) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function exportCSV() {
  const schedule = computeSchedule(); const list = sortedMilestones(); const idx = {}; list.forEach((m, i) => idx[m.id] = i + 1);
  const rows = [["ID", "Task Name", "Start", "Finish", "Duration", "Predecessors", "Status", "% Complete", "Trade", "Notes"]];
  list.forEach((m, i) => { const s = schedule[m.id] || {}; rows.push([i + 1, m.name, toISO(s.start), toISO(s.finish), m.duration, m.dependsOn ? idx[m.dependsOn] || "" : "", m.status, m.progress || 0, m.trade || "", m.notes || ""]); });
  downloadFile((DATA.project.title || "schedule").replace(/[^\w-]+/g, "-") + "-schedule.csv", "﻿" + toCSV(rows), "text/csv");
}

/* ============================================================
   SCHEDULE IMPORT (Excel / CSV / MS Project export / paste)
   Auto-detects columns (all overridable), previews exactly what
   will be saved, then replaces or appends in one save.
   ============================================================ */
const IMPORT_FIELDS = [
  ["id", "Row ID", ["id", "task id", "#", "no", "no.", "unique id", "wbs", "line"]],
  ["name", "Task / Milestone Name", ["task name", "name", "milestone", "task", "activity", "milestone name", "activity name", "item", "title", "description"]],
  ["start", "Start Date", ["start", "start date", "begin", "begin date", "planned start", "scheduled start", "baseline start"]],
  ["finish", "Finish Date", ["finish", "finish date", "end", "end date", "due", "due date", "planned finish", "scheduled finish", "completion date"]],
  ["duration", "Duration (working days)", ["duration", "days", "dur", "duration (days)", "business days", "work days", "working days"]],
  ["predecessor", "Predecessor / Depends On", ["predecessors", "predecessor", "depends on", "dependency", "dependencies", "after"]],
  ["status", "Status", ["status", "state"]],
  ["progress", "% Complete", ["% complete", "percent complete", "progress", "% done", "complete", "pct complete", "%"]],
  ["trade", "Trade", ["trade", "trades", "resource names", "resource", "resources", "contractor", "subcontractor", "sub", "assigned to"]],
  ["notes", "Notes", ["notes", "comments", "comment", "remarks"]],
];
const IMPORT = { rows: [], headers: [], headerRow: 0, map: {}, workbook: null, sheet: "", fileName: "" };

function normHeader(h) { return String(h == null ? "" : h).toLowerCase().replace(/[\s_]+/g, " ").replace(/[^a-z0-9%#. ()]/g, "").trim(); }
function cellText(v) { return v == null ? "" : String(v).trim(); }

function parseDelimited(text) {
  text = String(text || "").replace(/^﻿/, "");
  const firstLine = text.split(/\r?\n/)[0] || "";
  const delim = firstLine.includes("\t") ? "\t" : (firstLine.split(";").length > firstLine.split(",").length ? ";" : ",");
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"' && cell === "") q = true;
    else if (c === delim) { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(c => String(c).trim() !== ""));
}
function detectHeaderRow(rows) {
  const nameAliases = IMPORT_FIELDS.find(f => f[0] === "name")[2];
  const allAliases = [].concat(...IMPORT_FIELDS.map(f => f[2]));
  let best = 0, bestScore = -1;
  rows.slice(0, 15).forEach((r, i) => {
    const cells = r.map(normHeader);
    let score = cells.filter(c => c && allAliases.includes(c)).length;
    if (cells.some(c => nameAliases.includes(c))) score += 2;
    if (score > bestScore) { bestScore = score; best = i; }
  });
  return best;
}
function autoMapColumns(headers) {
  const norm = headers.map(normHeader), used = new Set(), map = {};
  IMPORT_FIELDS.forEach(([key, , aliases]) => {
    let idx = -1;
    for (const a of aliases) { idx = norm.findIndex((h, i) => !used.has(i) && h === a); if (idx >= 0) break; }
    if (idx < 0) for (const a of aliases) { if (a.length < 4) continue; idx = norm.findIndex((h, i) => !used.has(i) && h.includes(a)); if (idx >= 0) break; }
    map[key] = idx; if (idx >= 0) used.add(idx);
  });
  if (map.name < 0) map.name = norm.findIndex((h, i) => !used.has(i) && h);
  return map;
}

function excelSerialToDate(n) { const d = new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400000); return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); }
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
// order: "mdy" | "dmy" for ambiguous numeric dates like 03/04/2026
function parseFlexibleDate(v, order) {
  if (v == null || v === "") return null;
  if (v instanceof Date) { if (isNaN(v)) return null; const d = new Date(v.getTime() + 12 * 3600000); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  if (typeof v === "number") return v > 20000 && v < 80000 ? excelSerialToDate(v) : null;
  const s = String(v).trim().replace(/^(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)[a-z]*\.?,?\s+/i, "").replace(/\s+\d{1,2}:\d{2}.*$/, "").trim();
  if (!s || /^n\/?a$/i.test(s)) return null;
  if (/^\d+(\.\d+)?$/.test(s)) { const n = Number(s); return n > 20000 && n < 80000 ? excelSerialToDate(n) : null; }
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (m) {
    const a = +m[1], b = +m[2]; let y = +m[3]; if (y < 100) y += 2000;
    let mo, d;
    if (a > 12) { d = a; mo = b; } else if (b > 12) { mo = a; d = b; } else if (order === "dmy") { d = a; mo = b; } else { mo = a; d = b; }
    const out = new Date(y, mo - 1, d); return isNaN(out) ? null : out;
  }
  m = s.match(/^(\d{1,2})[\s-]+([a-z]{3,})\.?[\s,-]+(\d{2,4})$/i);
  if (m && MONTHS.includes(m[2].slice(0, 3).toLowerCase())) { let y = +m[3]; if (y < 100) y += 2000; return new Date(y, MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()), +m[1]); }
  m = s.match(/^([a-z]{3,})\.?\s+(\d{1,2})(st|nd|rd|th)?,?\s+(\d{2,4})$/i);
  if (m && MONTHS.includes(m[1].slice(0, 3).toLowerCase())) { let y = +m[4]; if (y < 100) y += 2000; return new Date(y, MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()), +m[2]); }
  const t = Date.parse(s); if (!isNaN(t)) { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  return null;
}
function guessDateOrder(values) {
  for (const v of values) {
    if (typeof v !== "string") continue;
    const m = v.replace(/^[a-z]+\.?,?\s+/i, "").match(/^(\d{1,2})[-/.](\d{1,2})[-/.]\d{2,4}/);
    if (m && +m[1] > 12) return "dmy";
    if (m && +m[2] > 12) return "mdy";
  }
  return "mdy";
}
function parseDuration(v) {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Math.max(1, Math.round(v));
  const m = String(v).toLowerCase().replace("?", "").trim().match(/(-?\d+(\.\d+)?)\s*([a-z]*)/); if (!m) return null;
  const n = Number(m[1]), unit = m[3] || "d";
  let days = n;
  if (/^(w|wk|wks|week|weeks|ew|ewk)/.test(unit)) days = n * 5;
  else if (/^(mo|mon|mons|month|months|emo)/.test(unit)) days = n * 21;
  else if (/^(h|hr|hrs|hour|hours|eh)/.test(unit)) days = n / 8;
  return Math.max(1, Math.round(days));
}
function parseProgress(v, scaleFraction) {
  if (v == null || v === "") return null;
  let n = typeof v === "number" ? v : Number(String(v).replace(/[%\s]/g, ""));
  if (isNaN(n)) return null;
  if (scaleFraction) n *= 100;
  return Math.max(0, Math.min(100, Math.round(n)));
}
function parseStatus(v, progress) {
  const s = cellText(v).toLowerCase();
  const direct = MILESTONE_STATUSES.find(x => x.toLowerCase() === s); if (direct) return direct;
  if (/(complete|done|finish|closed)/.test(s)) return "Complete";
  if (/(progress|started|underway|ongoing|active|working)/.test(s) && !/not/.test(s)) return "In Progress";
  if (/(delay|late|behind|overdue)/.test(s)) return "Delayed";
  if (/(hold|pause|wait)/.test(s)) return "On Hold";
  if (/cancel/.test(s)) return "Cancelled";
  if (s) return "Not Started";
  if (progress >= 100) return "Complete";
  if (progress > 0) return "In Progress";
  return "Not Started";
}

function buildImportPlan(opts) {
  const map = IMPORT.map, data = IMPORT.rows.slice(IMPORT.headerRow + 1);
  const cell = (r, key) => map[key] >= 0 ? r[map[key]] : "";
  const order = opts.dateOrder === "auto" ? guessDateOrder([].concat(...data.map(r => [cell(r, "start"), cell(r, "finish")]))) : opts.dateOrder;
  const progVals = data.map(r => cell(r, "progress")).filter(v => cellText(v) !== "").map(v => typeof v === "number" ? v : Number(String(v).replace(/[%\s]/g, ""))).filter(n => !isNaN(n));
  const progHasPct = data.some(r => /%/.test(cellText(cell(r, "progress"))));
  const scaleFraction = !progHasPct && progVals.length > 0 && Math.max(...progVals) <= 1 && progVals.some(n => n > 0 && n < 1);
  const typeCol = IMPORT.headers.map(normHeader).indexOf("type");

  const items = [];
  data.forEach((r, i) => {
    if (typeCol >= 0) { const t = cellText(r[typeCol]).toLowerCase(); if (t && !/(milestone|task|activity|phase)/.test(t)) return; }
    const name = cellText(cell(r, "name"));
    if (!name) return;
    const warnings = [];
    let start = parseFlexibleDate(cell(r, "start"), order);
    let finish = parseFlexibleDate(cell(r, "finish"), order);
    let duration = parseDuration(cell(r, "duration"));
    if (cellText(cell(r, "start")) && !start) warnings.push("start date not recognised");
    if (cellText(cell(r, "finish")) && !finish) warnings.push("finish date not recognised");
    if (start && finish && finish < start) { warnings.push("finish before start — used start only"); finish = null; }
    if (start && finish) duration = calculateBusinessDays(start, finish);
    else if (!start && finish) start = subtractBusinessDays(finish, duration || 1);
    duration = duration || 1;
    const progress = parseProgress(cell(r, "progress"), scaleFraction) || 0;
    items.push({
      key: uid("m"), rowId: map.id >= 0 ? cellText(cell(r, "id")) : String(items.length + 1), name, start, duration,
      predecessorRaw: cellText(cell(r, "predecessor")), status: parseStatus(cell(r, "status"), progress), progress,
      trade: cellText(cell(r, "trade")).replace(/\[.*?\]/g, "").trim(), notes: cellText(cell(r, "notes")), warnings,
    });
  });
  const byRowId = {}, byName = {};
  items.forEach(it => { byRowId[it.rowId] = it; byName[it.name.toLowerCase()] = it; });
  items.forEach(it => {
    it.dependsOnKey = null;
    if (!it.predecessorRaw) return;
    const parts = it.predecessorRaw.split(/[,;]/), first = parts[0].trim();
    const num = first.match(/^(\d+)/);
    const dep = (num && byRowId[num[1]]) || byName[first.toLowerCase()];
    if (dep && dep !== it) it.dependsOnKey = dep.key; else it.warnings.push(`predecessor "${first}" not found`);
    if (parts.length > 1) it.warnings.push("multiple predecessors — only the first is linked");
  });
  items.forEach(it => {
    const followDep = !opts.keepDates && it.dependsOnKey;
    it.manualStart = it.start && !followDep ? toISO(it.start) : null;
    if (!it.start && !it.dependsOnKey) it.warnings.push("no start date — will start on the project start date");
  });
  return { items, order };
}

function openImportModal() {
  if (ROLE !== "admin") return;
  Object.assign(IMPORT, { rows: [], headers: [], headerRow: 0, map: {}, workbook: null, sheet: "", fileName: "" });
  openModal(`
    <h2>Import Schedule</h2>
    <p class="muted">Upload an Excel (.xlsx / .xls) or CSV file — including an MS Project export saved as Excel/CSV — or paste rows copied from a spreadsheet. Columns are detected automatically; check the preview, then import. It saves to the live site straight away.</p>
    <div class="import-source">
      <label>File<input type="file" id="impFile" accept=".xlsx,.xls,.xlsm,.ods,.csv,.tsv,.txt" /></label>
      <label>…or paste from Excel / Google Sheets<textarea id="impPaste" placeholder="Copy the rows (including the header row) and paste here"></textarea></label>
    </div>
    <p style="margin:0 0 12px;"><a href="#" id="impTemplate">Download a blank template (CSV)</a></p>
    <div id="impMapping"></div>
    <div id="impPreview"></div>
    <div class="modal-actions sticky"><button class="btn btn-primary" id="impSave" disabled>Import</button><button class="btn" data-close>Cancel</button></div>`, true);
  document.getElementById("impTemplate").onclick = (e) => { e.preventDefault(); downloadTemplate(); };
  document.getElementById("impFile").onchange = (e) => { const f = e.target.files[0]; if (f) loadImportFile(f); };
  let t;
  document.getElementById("impPaste").oninput = (e) => {
    clearTimeout(t);
    t = setTimeout(() => { if (e.target.value.trim()) { IMPORT.fileName = "pasted rows"; IMPORT.workbook = null; setImportRows(parseDelimited(e.target.value)); } }, 250);
  };
  document.getElementById("impSave").onclick = saveImport;
}
function loadImportFile(file) {
  IMPORT.fileName = file.name;
  const reader = new FileReader();
  reader.onerror = () => alert("Could not read that file.");
  if (/\.(xlsx|xls|xlsm|ods)$/i.test(file.name)) {
    if (typeof XLSX === "undefined") { alert("The Excel reader didn't load (check your internet connection). You can save the sheet as CSV and import that instead."); return; }
    reader.onload = () => {
      try {
        IMPORT.workbook = XLSX.read(new Uint8Array(reader.result), { type: "array", cellDates: true });
        const sheet = IMPORT.workbook.SheetNames.find(n => XLSX.utils.sheet_to_json(IMPORT.workbook.Sheets[n], { header: 1 }).length > 1) || IMPORT.workbook.SheetNames[0];
        selectSheet(sheet);
      } catch (err) { alert("Could not read that spreadsheet: " + err.message); }
    };
    reader.readAsArrayBuffer(file);
  } else {
    IMPORT.workbook = null;
    reader.onload = () => setImportRows(parseDelimited(reader.result));
    reader.readAsText(file);
  }
}
function selectSheet(name) {
  IMPORT.sheet = name;
  const rows = XLSX.utils.sheet_to_json(IMPORT.workbook.Sheets[name], { header: 1, raw: true, defval: "" });
  setImportRows(rows.filter(r => r.some(c => String(c).trim() !== "")));
}
function setImportRows(rows) {
  IMPORT.rows = rows;
  IMPORT.headerRow = detectHeaderRow(rows);
  IMPORT.headers = (rows[IMPORT.headerRow] || []).map(cellText);
  IMPORT.map = autoMapColumns(IMPORT.headers);
  renderImportMapping(); renderImportPreview();
}
function renderImportMapping() {
  const el = document.getElementById("impMapping"); if (!el) return;
  if (!IMPORT.rows.length) { el.innerHTML = `<p class="red">No rows found in ${escapeHtml(IMPORT.fileName)}.</p>`; return; }
  const colOpts = sel => `<option value="-1">— not in file —</option>` + IMPORT.headers.map((h, i) => `<option value="${i}" ${sel === i ? "selected" : ""}>${escapeHtml(h || "Column " + (i + 1))}</option>`).join("");
  const sheetSel = IMPORT.workbook && IMPORT.workbook.SheetNames.length > 1
    ? `<label>Sheet<select id="impSheet">${IMPORT.workbook.SheetNames.map(n => `<option ${n === IMPORT.sheet ? "selected" : ""}>${escapeHtml(n)}</option>`).join("")}</select></label>` : "";
  const existing = DATA.milestones.length;
  el.innerHTML = `
    <h3>Columns <span class="muted small">from ${escapeHtml(IMPORT.fileName)}</span></h3>
    <div class="form-grid import-map">
      ${sheetSel}
      <label>Header row<select id="impHeaderRow">${IMPORT.rows.slice(0, 15).map((r, i) => `<option value="${i}" ${i === IMPORT.headerRow ? "selected" : ""}>Row ${i + 1}: ${escapeHtml(r.filter(Boolean).slice(0, 3).join(", ").slice(0, 40))}</option>`).join("")}</select></label>
      ${IMPORT_FIELDS.map(([key, label]) => `<label>${label}<select data-map="${key}">${colOpts(IMPORT.map[key])}</select></label>`).join("")}
    </div>
    <h3>Options</h3>
    <div class="form-grid import-map">
      <label>Date format<select id="impDateOrder"><option value="auto">Auto-detect</option><option value="mdy">MM/DD/YYYY</option><option value="dmy">DD/MM/YYYY</option></select></label>
      <label>Existing milestones<select id="impMode" ${existing ? "" : "disabled"}>
        <option value="replace">Replace the current schedule (${existing} milestones)</option>
        <option value="append">Add to the current schedule</option></select></label>
    </div>
    <label class="checkline"><input type="checkbox" id="impKeepDates" checked /> Keep the file's dates exactly (uncheck to recalculate dates from predecessors)</label>
    <label class="checkline"><input type="checkbox" id="impSetDates" ${DATA.project.start ? "" : "checked"} /> Set the project start${DATA.project.targetCompletion ? "" : " and target completion"} from the imported schedule</label>`;
  el.querySelectorAll("[data-map]").forEach(s => s.onchange = () => { IMPORT.map[s.dataset.map] = Number(s.value); renderImportPreview(); });
  el.querySelectorAll("#impDateOrder, #impKeepDates, #impMode").forEach(s => s.onchange = renderImportPreview);
  document.getElementById("impHeaderRow").onchange = (e) => {
    IMPORT.headerRow = Number(e.target.value);
    IMPORT.headers = (IMPORT.rows[IMPORT.headerRow] || []).map(cellText);
    IMPORT.map = autoMapColumns(IMPORT.headers); renderImportMapping(); renderImportPreview();
  };
  const sheetEl = document.getElementById("impSheet"); if (sheetEl) sheetEl.onchange = (e) => selectSheet(e.target.value);
}
function importOptions() {
  const v = id => document.getElementById(id);
  return {
    dateOrder: v("impDateOrder") ? v("impDateOrder").value : "auto",
    keepDates: v("impKeepDates") ? v("impKeepDates").checked : true,
    mode: v("impMode") && !v("impMode").disabled ? v("impMode").value : "replace",
    setProjectDates: v("impSetDates") ? v("impSetDates").checked : false,
  };
}
function renderImportPreview() {
  const el = document.getElementById("impPreview"), save = document.getElementById("impSave"); if (!el) return;
  if (!IMPORT.rows.length) { el.innerHTML = ""; save.disabled = true; return; }
  if (IMPORT.map.name < 0) { el.innerHTML = `<p class="red">Choose which column holds the task / milestone name.</p>`; save.disabled = true; return; }
  const plan = buildImportPlan(importOptions());
  const names = {}; plan.items.forEach(it => names[it.key] = it.name);
  const warn = plan.items.filter(it => it.warnings.length).length;
  save.disabled = !plan.items.length;
  save.textContent = `Import ${plan.items.length} milestone${plan.items.length === 1 ? "" : "s"}`;
  el.innerHTML = `
    <h3>Preview <span class="muted small">${plan.items.length} milestones · dates read as ${plan.order === "dmy" ? "DD/MM/YYYY" : "MM/DD/YYYY"}${warn ? ` · <span class="amber">${warn} with notes</span>` : ""}</span></h3>
    <div class="import-preview"><table class="data-table">
      <thead><tr><th>#</th><th>Name</th><th>Start</th><th>Dur.</th><th>Follows</th><th>Status</th><th>%</th><th>Trade</th></tr></thead>
      <tbody>${plan.items.slice(0, 300).map(it => `<tr>
        <td class="muted">${escapeHtml(it.rowId)}</td>
        <td>${escapeHtml(it.name)}${it.warnings.length ? `<div class="import-warn">${it.warnings.map(escapeHtml).join("; ")}</div>` : ""}</td>
        <td class="nowrap">${it.start ? fmtDateLong(it.start) : '<span class="muted">—</span>'}</td><td>${it.duration}d</td>
        <td>${it.dependsOnKey ? escapeHtml(names[it.dependsOnKey]) : ""}</td><td>${escapeHtml(it.status)}</td><td>${it.progress}%</td><td>${escapeHtml(it.trade)}</td>
      </tr>`).join("")}</tbody>
    </table></div>
    ${plan.items.length > 300 ? `<p class="muted">Showing the first 300 of ${plan.items.length}.</p>` : ""}`;
}
function saveImport() {
  const opts = importOptions(), plan = buildImportPlan(opts);
  if (!plan.items.length) return;
  if (opts.mode === "replace" && DATA.milestones.length && !confirm(`Replace the current ${DATA.milestones.length} milestones with ${plan.items.length} imported ones?`)) return;
  const base = opts.mode === "append" ? DATA.milestones.reduce((mx, m) => Math.max(mx, (m.order || 0) + 1), 0) : 0;
  const recs = plan.items.map((it, i) => {
    const r = { id: it.key, name: it.name, trade: it.trade, duration: it.duration, status: it.status, progress: it.progress, notes: it.notes, order: base + i };
    if (it.dependsOnKey) r.dependsOn = it.dependsOnKey;
    if (it.manualStart) r.manualStart = it.manualStart;
    return r;
  });
  DATA.milestones = opts.mode === "append" ? DATA.milestones.concat(recs) : recs;
  if (opts.setProjectDates) {
    const starts = plan.items.map(it => it.start).filter(Boolean);
    if (starts.length) {
      const first = new Date(Math.min(...starts));
      DATA.project.start = toISO(first);
      if (!DATA.project.targetCompletion) DATA.project.targetCompletion = toISO(plan.items.filter(it => it.start).map(it => addBusinessDays(it.start, it.duration)).reduce((a, b) => (b > a ? b : a), first));
    }
  }
  closeModal();
  markChanged(`import ${recs.length} milestones from ${IMPORT.fileName || "file"}`);
  toast(`Imported ${recs.length} milestones — saving to the live site…`);
}
function downloadTemplate() {
  downloadFile("schedule-import-template.csv", "﻿" + toCSV([
    ["ID", "Task Name", "Start", "Finish", "Duration", "Predecessors", "Status", "% Complete", "Trade", "Notes"],
    ["1", "Site mobilization", "2026-11-02", "2026-11-06", "", "", "Not Started", "0", "General Contractor", ""],
    ["2", "Excavation", "", "", "10", "1", "Not Started", "0", "Excavation", "Starts after mobilization"],
    ["3", "Footings & foundation", "2026-11-23", "2026-12-11", "", "2", "Not Started", "0", "Concrete", ""],
  ]), "text/csv");
}

/* ============================================================
   INIT
   ============================================================ */
function init() {
  document.getElementById("btnAdmin").onclick = openLoginModal;
  document.getElementById("btnLogout").onclick = adminLogout;
  document.getElementById("btnImport").onclick = openImportModal;
  document.getElementById("btnAddMilestone").onclick = () => openMilestoneEditor(null);
  document.getElementById("btnProjectDetails").onclick = openProjectEditor;
  document.getElementById("btnExportCSV").onclick = exportCSV;
  document.getElementById("btnPrint").onclick = () => window.print();
  document.getElementById("btnPreviewClient").onclick = () => { UI.previewAsClient = true; render(); window.scrollTo(0, 0); };
  document.getElementById("btnExitPreview").onclick = () => { UI.previewAsClient = false; render(); };
  document.getElementById("btnClearAll").onclick = () => {
    if (!DATA.milestones.length) return;
    if (!confirm(`Delete all ${DATA.milestones.length} milestones from the live schedule? This can't be undone.`)) return;
    DATA.milestones = []; markChanged("delete all milestones");
  };
  document.getElementById("modalOverlay").onclick = (e) => { if (e.target.id === "modalOverlay") closeModal(); };
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });
  window.addEventListener("beforeunload", (e) => { if (ROLE === "admin" && (SAVE.dirty || SAVE.inFlight)) { e.preventDefault(); e.returnValue = ""; } });
  let rt; window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(renderGantt, 150); });

  // Clients: keep the schedule fresh without anyone pressing refresh.
  setInterval(loadPublished, Math.max(10, CFG.pollSeconds) * 1000);
  setInterval(() => { if (UI.live !== null) setLive(UI.live); }, 30000); // refresh "updated x min ago"
  document.addEventListener("visibilitychange", () => { if (!document.hidden) loadPublished(); });

  render();
  const saved = storageGet(TOKEN_KEY);
  if (saved) {
    adminLogin(saved).catch(err => { TOKEN = null; storageDel(TOKEN_KEY); toast("Admin session expired — log in again"); loadPublished(); });
  } else loadPublished();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
