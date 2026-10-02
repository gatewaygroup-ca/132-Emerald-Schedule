import Gantt, { Legend } from "./Gantt";
import LocalDate from "./LocalDate";
import { durationDays, formatDuration, formatShort, formatShortYear } from "@/lib/dates";
import { scheduleRange } from "@/lib/project";
import { DOT_CLASS } from "@/lib/status";
import { STATUS_LABELS, type Project } from "@/lib/types";

type Props = Pick<Project, "projectName" | "propertyAddress" | "schedule" | "updatedAt">;

/** The client-facing schedule. Used by the public page and the admin live preview. */
export default function ScheduleView({ projectName, propertyAddress, schedule, updatedAt }: Props) {
  const range = scheduleRange(schedule);
  const current = schedule.filter((i) => i.status === "in-progress" || i.status === "delayed");
  const next = schedule
    .filter((i) => i.status === "upcoming")
    .sort((a, b) => a.startDate.localeCompare(b.startDate))[0];

  return (
    <div>
      <header className="border-b border-slate-200 pb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Project Schedule</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
          {propertyAddress || "Property address"}
        </h1>
        {projectName && <p className="mt-1 text-base text-slate-600">{projectName}</p>}

        <dl className="mt-5 grid grid-cols-1 gap-x-10 gap-y-3 text-sm sm:flex sm:flex-wrap">
          {range && (
            <div>
              <dt className="text-xs text-slate-500">Schedule</dt>
              <dd className="font-medium text-slate-900">
                {formatShortYear(range.start)} – {formatShortYear(range.end)}
              </dd>
            </div>
          )}
          <div>
            <dt className="text-xs text-slate-500">Currently</dt>
            <dd className="font-medium text-slate-900">
              {current.length ? current.map((i) => i.activity).join(", ") : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Up next</dt>
            <dd className="font-medium text-slate-900">
              {next ? `${next.activity} · starts ${formatShort(next.startDate)}` : "—"}
            </dd>
          </div>
        </dl>
      </header>

      <section className="mt-8">
        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <h2 className="text-base font-semibold text-slate-900">Timeline</h2>
          <Legend />
        </div>
        <Gantt items={schedule} />
        <p className="mt-2 text-xs text-slate-400 sm:hidden">Swipe the chart sideways to see the full timeline.</p>
      </section>

      {schedule.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-3 text-base font-semibold text-slate-900">Schedule details</h2>
          <div className="overflow-hidden rounded-md border border-slate-200">
            <div className="hidden grid-cols-[minmax(0,1fr)_7rem_7rem_6rem_8rem] gap-4 border-b border-slate-200 bg-slate-50 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500 sm:grid">
              <div>Activity</div>
              <div>Start</div>
              <div>End</div>
              <div>Duration</div>
              <div>Status</div>
            </div>
            <ul>
              {schedule.map((i) => (
                <li
                  key={i.id}
                  className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-0.5 border-b border-slate-100 px-4 py-3 text-sm last:border-b-0 sm:grid-cols-[minmax(0,1fr)_7rem_7rem_6rem_8rem] sm:items-center"
                >
                  <div className="font-medium text-slate-900">{i.activity}</div>
                  <div className="text-right text-slate-600 sm:hidden">
                    <StatusTag status={i.status} />
                  </div>
                  <div className="col-span-2 text-xs tabular-nums text-slate-500 sm:hidden">
                    {formatShort(i.startDate)} → {formatShort(i.endDate)} · {formatDuration(durationDays(i.startDate, i.endDate))}
                  </div>
                  <div className="hidden tabular-nums text-slate-700 sm:block">{formatShortYear(i.startDate)}</div>
                  <div className="hidden tabular-nums text-slate-700 sm:block">{formatShortYear(i.endDate)}</div>
                  <div className="hidden tabular-nums text-slate-700 sm:block">
                    {formatDuration(durationDays(i.startDate, i.endDate))}
                  </div>
                  <div className="hidden sm:block">
                    <StatusTag status={i.status} />
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      <footer className="mt-10 border-t border-slate-200 pt-4 text-sm text-slate-500">
        <span className="font-medium text-slate-700">Last Updated:</span> <LocalDate iso={updatedAt} />
      </footer>
    </div>
  );
}

function StatusTag({ status }: { status: Project["schedule"][number]["status"] }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-slate-700">
      <span className={`h-2 w-2 rounded-full ${DOT_CLASS[status]}`} />
      {STATUS_LABELS[status]}
    </span>
  );
}
