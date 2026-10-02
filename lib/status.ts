import type { Status } from "./types";

/** Tailwind classes for each status (colours are defined in app/globals.css). */
export const BAR_CLASS: Record<Status, string> = {
  complete: "bg-st-complete text-white",
  "in-progress": "bg-st-progress text-white",
  upcoming: "bg-st-upcoming border border-st-upcoming-border text-slate-700",
  delayed: "bg-st-delayed text-white",
};

export const DOT_CLASS: Record<Status, string> = {
  complete: "bg-st-complete",
  "in-progress": "bg-st-progress",
  upcoming: "bg-st-upcoming border border-st-upcoming-border",
  delayed: "bg-st-delayed",
};
