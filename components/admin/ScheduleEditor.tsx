"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { saveSchedule } from "@/app/admin/actions";
import ScheduleView from "@/components/ScheduleView";
import { addDays, durationDays, formatDuration, isIsoDate, localToday, fromDay } from "@/lib/dates";
import { newId, validateProject } from "@/lib/project";
import { STATUSES, STATUS_LABELS, type Project, type ScheduleItem, type Status } from "@/lib/types";

const input =
  "w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-200";
const iconBtn =
  "flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-30";

type Publish = { editUrl: string; allProjects: Project[] };

export default function ScheduleEditor({
  initial,
  publish,
  isNew = false,
}: {
  initial: Project;
  /** Set when the server can't save: changes are published by committing on github.com. */
  publish?: Publish;
  isNew?: boolean;
}) {
  const [projectName, setProjectName] = useState(initial.projectName);
  const [propertyAddress, setPropertyAddress] = useState(initial.propertyAddress);
  const [schedule, setSchedule] = useState<ScheduleItem[]>(initial.schedule);
  const [updatedAt, setUpdatedAt] = useState(initial.updatedAt);
  const [dirty, setDirty] = useState(isNew);
  const [publishJson, setPublishJson] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [savedMsg, setSavedMsg] = useState("");
  const [saving, startSaving] = useTransition();

  // Warn before leaving with unsaved changes.
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  function touch() {
    setDirty(true);
    setSavedMsg("");
    setPublishJson(null);
  }

  function updateItem(id: string, patch: Partial<ScheduleItem>) {
    setSchedule((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    touch();
  }

  function move(index: number, delta: number) {
    setSchedule((rows) => {
      const next = [...rows];
      const [row] = next.splice(index, 1);
      next.splice(index + delta, 0, row);
      return next;
    });
    touch();
  }

  function remove(item: ScheduleItem) {
    if (!confirm(`Delete “${item.activity || "this activity"}”?`)) return;
    setSchedule((rows) => rows.filter((r) => r.id !== item.id));
    touch();
  }

  function add() {
    const lastEnd = schedule.reduce<string | null>(
      (max, r) => (isIsoDate(r.endDate) && (!max || r.endDate > max) ? r.endDate : max),
      null,
    );
    const start = lastEnd ? addDays(lastEnd, 1) : fromDay(localToday());
    setSchedule((rows) => [
      ...rows,
      { id: newId(), activity: "", startDate: start, endDate: addDays(start, 6), status: "upcoming" },
    ]);
    touch();
  }

  function copy(text: string) {
    navigator.clipboard?.writeText(text).then(
      () => setCopied(true),
      () => setCopied(false),
    );
  }

  function preparePublish(p: Publish) {
    const result = validateProject({ projectName, propertyAddress, schedule });
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    const updated: Project = { slug: initial.slug, ...result.project, updatedAt: new Date().toISOString() };
    const exists = p.allProjects.some((x) => x.slug === initial.slug);
    const all = exists
      ? p.allProjects.map((x) => (x.slug === initial.slug ? updated : x))
      : [...p.allProjects, updated];
    const json = JSON.stringify(all, null, 2) + "\n";
    setPublishJson(json);
    setCopied(false);
    copy(json);
    setDirty(false);
  }

  function save() {
    setErrors([]);
    if (publish) return preparePublish(publish);
    startSaving(async () => {
      const res = await saveSchedule(initial.slug, { projectName, propertyAddress, schedule });
      if (res.ok) {
        setUpdatedAt(res.updatedAt);
        setDirty(false);
        setSavedMsg("Saved");
      } else {
        setErrors(res.errors);
      }
    });
  }

  return (
    <div>
      {/* Sticky toolbar */}
      <div className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-8">
          <div className="flex min-w-0 items-center gap-4 text-sm">
            <Link href="/admin" className="shrink-0 text-slate-500 hover:text-slate-900">
              ← All projects
            </Link>
            <Link href={`/project/${initial.slug}`} target="_blank" className="hidden truncate text-slate-500 hover:text-slate-900 sm:inline">
              Client view: /project/{initial.slug} ↗
            </Link>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <span className="text-sm text-slate-500" aria-live="polite">
              {saving ? "Saving…" : dirty ? "Unsaved changes" : publishJson ? "Ready to publish ↓" : savedMsg}
            </span>
            <button
              type="button"
              onClick={save}
              disabled={saving || !dirty}
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-40"
            >
              {publish ? "Publish on GitHub" : "Save changes"}
            </button>
          </div>
        </div>
      </div>

      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-8">
        <h1 className="text-xl font-semibold text-slate-900">Edit schedule</h1>

        {errors.length > 0 && (
          <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            <p className="font-medium">Not saved. Please fix the following:</p>
            <ul className="mt-1 list-disc pl-5">
              {errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </div>
        )}

        <section className="mt-6 grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">Property address</span>
            <input
              value={propertyAddress}
              onChange={(e) => {
                setPropertyAddress(e.target.value);
                touch();
              }}
              className={input}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">
              Project name <span className="font-normal text-slate-400">(optional)</span>
            </span>
            <input
              value={projectName}
              onChange={(e) => {
                setProjectName(e.target.value);
                touch();
              }}
              className={input}
            />
          </label>
        </section>

        <section className="mt-8">
          <h2 className="mb-3 text-base font-semibold text-slate-900">Activities</h2>

          <div className="hidden grid-cols-[minmax(0,1fr)_9.5rem_9.5rem_5.5rem_9rem_7.5rem] gap-3 px-1 pb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500 lg:grid">
            <div>Activity / trade</div>
            <div>Start</div>
            <div>End</div>
            <div>Duration</div>
            <div>Status</div>
            <div className="text-right">Order</div>
          </div>

          <ul className="divide-y divide-slate-100 border-y border-slate-200">
            {schedule.map((item, i) => {
              const bad = isIsoDate(item.startDate) && isIsoDate(item.endDate) && item.endDate < item.startDate;
              const days = durationDays(item.startDate, item.endDate);
              return (
                <li
                  key={item.id}
                  className="grid grid-cols-2 gap-3 px-1 py-3 lg:grid-cols-[minmax(0,1fr)_9.5rem_9.5rem_5.5rem_9rem_7.5rem] lg:items-center"
                >
                  <label className="col-span-2 lg:col-span-1">
                    <span className="sr-only">Activity</span>
                    <input
                      value={item.activity}
                      placeholder="Activity name"
                      onChange={(e) => updateItem(item.id, { activity: e.target.value })}
                      className={`${input} font-medium`}
                    />
                  </label>
                  <label>
                    <span className="mb-1 block text-xs text-slate-500 lg:sr-only">Start</span>
                    <input
                      type="date"
                      value={item.startDate}
                      onChange={(e) => updateItem(item.id, { startDate: e.target.value })}
                      className={input}
                    />
                  </label>
                  <label>
                    <span className="mb-1 block text-xs text-slate-500 lg:sr-only">End</span>
                    <input
                      type="date"
                      value={item.endDate}
                      min={item.startDate || undefined}
                      onChange={(e) => updateItem(item.id, { endDate: e.target.value })}
                      className={`${input} ${bad ? "border-red-400" : ""}`}
                    />
                  </label>
                  <div className={`text-sm tabular-nums ${bad ? "text-red-700" : "text-slate-600"}`}>
                    <span className="text-xs text-slate-500 lg:hidden">Duration: </span>
                    {bad ? "End before start" : days ? formatDuration(days) : "—"}
                  </div>
                  <label>
                    <span className="sr-only">Status</span>
                    <select
                      value={item.status}
                      onChange={(e) => updateItem(item.id, { status: e.target.value as Status })}
                      className={input}
                    >
                      {STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {STATUS_LABELS[s]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="col-span-2 flex items-center justify-end gap-1.5 lg:col-span-1">
                    <button type="button" className={iconBtn} onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up" title="Move up">
                      ↑
                    </button>
                    <button
                      type="button"
                      className={iconBtn}
                      onClick={() => move(i, 1)}
                      disabled={i === schedule.length - 1}
                      aria-label="Move down"
                      title="Move down"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className={`${iconBtn} hover:border-red-200 hover:text-red-700`}
                      onClick={() => remove(item)}
                      aria-label="Delete activity"
                      title="Delete"
                    >
                      ✕
                    </button>
                  </div>
                </li>
              );
            })}
            {schedule.length === 0 && <li className="px-1 py-6 text-sm text-slate-500">No activities yet.</li>}
          </ul>

          <div className="mt-4 flex items-center justify-between">
            <button
              type="button"
              onClick={add}
              className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50"
            >
              + Add activity
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving || !dirty}
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-40"
            >
              {publish ? "Publish on GitHub" : "Save changes"}
            </button>
          </div>

          {publish && publishJson && (
            <div className="mt-6 rounded-md border border-slate-300 bg-slate-50 p-4 text-sm text-slate-800">
              <p className="font-semibold text-slate-900">Publish this update on GitHub</p>
              <ol className="mt-2 list-decimal space-y-1 pl-5">
                <li>
                  {copied ? "The update is copied." : "Copy the update:"}{" "}
                  <button type="button" onClick={() => copy(publishJson)} className="font-medium underline">
                    {copied ? "Copy again" : "Copy update"}
                  </button>
                </li>
                <li>
                  <a href={publish.editUrl} target="_blank" rel="noreferrer" className="font-medium underline">
                    Open the schedule file on GitHub ↗
                  </a>{" "}
                  (sign in if asked).
                </li>
                <li>Click in the file, select all (Ctrl/Cmd + A), and paste (Ctrl/Cmd + V).</li>
                <li>
                  Click <strong>Commit changes…</strong>, then <strong>Commit changes</strong> again.
                </li>
              </ol>
              <p className="mt-2 text-slate-600">The client page updates about a minute after you commit.</p>
              <textarea
                readOnly
                value={publishJson}
                onFocus={(e) => e.currentTarget.select()}
                className="mt-3 h-28 w-full rounded-md border border-slate-300 bg-white p-2 font-mono text-xs text-slate-700"
                aria-label="Update to paste into GitHub"
              />
            </div>
          )}
        </section>

        <section className="mt-14">
          <div className="mb-4 flex items-baseline justify-between border-b border-slate-200 pb-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Client preview</h2>
            <span className="text-xs text-slate-400">{dirty ? "Showing unsaved changes" : "Matches the client page"}</span>
          </div>
          <ScheduleView
            projectName={projectName}
            propertyAddress={propertyAddress}
            schedule={schedule}
            updatedAt={updatedAt}
          />
        </section>
      </main>
    </div>
  );
}
