"use client";

import { useEffect, useRef, useState } from "react";
import {
  dayToDate,
  durationDays,
  formatDuration,
  formatShort,
  isIsoDate,
  localToday,
  toDay,
} from "@/lib/dates";
import { scheduleRange } from "@/lib/project";
import { BAR_CLASS, DOT_CLASS } from "@/lib/status";
import { STATUS_LABELS, type ScheduleItem, type Status } from "@/lib/types";

const monthFmt = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long", year: "numeric" });
const monthShortFmt = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short" });

/** First day of the month containing `day`. */
function monthStart(day: number): number {
  const d = dayToDate(day);
  return toDay(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`);
}

/** First day of the month after the one containing `day`. */
function nextMonthStart(day: number): number {
  const d = dayToDate(day);
  const y = d.getUTCFullYear() + (d.getUTCMonth() === 11 ? 1 : 0);
  const m = (d.getUTCMonth() + 1) % 12;
  return toDay(`${y}-${String(m + 1).padStart(2, "0")}-01`);
}

export default function Gantt({ items }: { items: ScheduleItem[] }) {
  const [today, setToday] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const didScroll = useRef(false);

  // "Today" depends on the viewer's clock, so compute it in the browser.
  useEffect(() => setToday(localToday()), []);

  // Measure the space available for the timeline (container minus activity column).
  const [fitWidth, setFitWidth] = useState<number | null>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => {
      const leftCol = el.querySelector<HTMLElement>("[data-left-col]")?.offsetWidth ?? 0;
      setFitWidth(Math.max(0, Math.floor(el.clientWidth - leftCol) - 1));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const rows = items.filter((i) => isIsoDate(i.startDate) && isIsoDate(i.endDate) && i.endDate >= i.startDate);
  const range = scheduleRange(rows);

  // Timeline spans whole months around the schedule.
  const first = range ? monthStart(toDay(range.start)) : 0;
  const last = range ? nextMonthStart(toDay(range.end)) : 0; // exclusive
  const totalDays = last - first;
  // Minimum day width keeps bars readable; on wide screens the chart stretches to fill.
  const minDayW = totalDays > 400 ? 3 : totalDays > 220 ? 5 : 7;
  const dayW = fitWidth && totalDays ? Math.max(minDayW, fitWidth / totalDays) : minDayW;
  const width = totalDays * dayW;
  const showWeekLabels = dayW >= 5;

  const months: { start: number; days: number }[] = [];
  for (let d = first; d < last; d = nextMonthStart(d)) {
    months.push({ start: d, days: nextMonthStart(d) - d });
  }
  const mondays: number[] = [];
  for (let d = first; d < last; d++) if (dayToDate(d).getUTCDay() === 1) mondays.push(d);

  const todayX = today !== null && today >= first && today < last ? (today - first + 0.5) * dayW : null;

  // On first load, if "today" is off-screen (phones), scroll it into view.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || todayX === null || didScroll.current) return;
    didScroll.current = true;
    const leftCol = el.querySelector<HTMLElement>("[data-left-col]")?.offsetWidth ?? 0;
    const visible = el.clientWidth - leftCol;
    if (todayX > visible - 48) el.scrollLeft = todayX - visible / 3;
  }, [todayX]);

  if (!range) {
    return (
      <div className="rounded-md border border-slate-200 px-4 py-12 text-center text-sm text-slate-500">
        No schedule items yet.
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      className="overflow-x-auto rounded-md border border-slate-200 [--left:9rem] sm:[--left:15rem]"
    >
      <div className="relative" style={{ width: `calc(var(--left) + ${width}px)` }}>
        {/* Grid lines (behind everything) */}
        <div aria-hidden className="pointer-events-none absolute inset-y-0" style={{ left: "var(--left)", width }}>
          {mondays.map((d) => (
            <div key={d} className="absolute top-7 bottom-0 w-px bg-slate-100" style={{ left: (d - first) * dayW }} />
          ))}
          {months.map((m) => (
            <div key={m.start} className="absolute inset-y-0 w-px bg-slate-200" style={{ left: (m.start - first) * dayW }} />
          ))}
        </div>

        {/* Header: months */}
        <div className="flex h-7 border-b border-slate-200">
          <div
            data-left-col
            className="sticky left-0 z-20 flex w-[var(--left)] shrink-0 items-center border-r border-slate-200 bg-white px-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500"
          >
            Activity
          </div>
          <div className="relative" style={{ width }}>
            {months.map((m) => (
              <div
                key={m.start}
                className="absolute inset-y-0 flex items-center overflow-hidden whitespace-nowrap px-2 text-xs font-semibold text-slate-700"
                style={{ left: (m.start - first) * dayW, width: m.days * dayW }}
              >
                {m.days * dayW >= 110 ? monthFmt.format(dayToDate(m.start)) : monthShortFmt.format(dayToDate(m.start))}
              </div>
            ))}
          </div>
        </div>

        {/* Header: weeks (Monday dates) */}
        <div className="flex h-6 border-b border-slate-200">
          <div className="sticky left-0 z-20 flex w-[var(--left)] shrink-0 items-center border-r border-slate-200 bg-white px-3 text-[11px] text-slate-400">
            {showWeekLabels ? "Week of" : ""}
          </div>
          <div className="relative" style={{ width }}>
            {showWeekLabels &&
              mondays.map((d) => (
                <div
                  key={d}
                  className="absolute inset-y-0 flex items-center pl-1 text-[11px] tabular-nums text-slate-500"
                  style={{ left: (d - first) * dayW }}
                >
                  {dayToDate(d).getUTCDate()}
                </div>
              ))}
          </div>
        </div>

        {/* Rows */}
        {rows.map((item) => {
          const s = toDay(item.startDate);
          const e = toDay(item.endDate);
          const days = durationDays(item.startDate, item.endDate);
          const barW = (e - s + 1) * dayW;
          const label = `${item.activity}: ${formatShort(item.startDate)} → ${formatShort(item.endDate)}, ${formatDuration(days)} (${STATUS_LABELS[item.status]})`;
          return (
            <div key={item.id} className="flex h-12 border-b border-slate-100 last:border-b-0">
              <div className="sticky left-0 z-20 flex w-[var(--left)] shrink-0 flex-col justify-center border-r border-slate-200 bg-white px-3">
                <div className="flex items-center gap-2">
                  <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${DOT_CLASS[item.status]}`} />
                  <span className="truncate text-sm font-medium text-slate-900" title={item.activity}>
                    {item.activity}
                  </span>
                </div>
                <div className="truncate pl-[18px] text-[11px] tabular-nums text-slate-500">
                  {formatShort(item.startDate)} → {formatShort(item.endDate)}
                  <span className="hidden sm:inline"> · {formatDuration(days)}</span>
                </div>
              </div>
              <div className="relative" style={{ width }}>
                <div
                  role="img"
                  aria-label={label}
                  title={label}
                  className={`absolute top-1/2 flex h-6 -translate-y-1/2 items-center overflow-hidden rounded-[3px] px-2 text-[11px] font-medium whitespace-nowrap ${BAR_CLASS[item.status]}`}
                  style={{ left: (s - first) * dayW, width: barW }}
                >
                  {barW >= 64 ? formatDuration(days) : ""}
                </div>
              </div>
            </div>
          );
        })}

        {/* Today line (above bars, below the sticky activity column) */}
        {todayX !== null && (
          <div aria-hidden className="pointer-events-none absolute inset-y-0 z-10" style={{ left: "var(--left)", width }}>
            <div className="absolute top-7 bottom-0 w-0.5 -translate-x-1/2 bg-slate-800" style={{ left: todayX }} />
            <div
              className="absolute top-[30px] -translate-x-1/2 rounded-sm bg-slate-800 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-white"
              style={{ left: todayX }}
            >
              Today
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function Legend() {
  const items: Status[] = ["complete", "in-progress", "upcoming", "delayed"];
  return (
    <ul className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-slate-600">
      {items.map((s) => (
        <li key={s} className="flex items-center gap-1.5">
          <span className={`inline-block h-3 w-5 rounded-[2px] ${DOT_CLASS[s]}`} />
          {STATUS_LABELS[s]}
        </li>
      ))}
      <li className="flex items-center gap-1.5">
        <span className="inline-block h-3 w-0.5 bg-slate-800" />
        Today
      </li>
    </ul>
  );
}
