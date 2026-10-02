"use client";

import { useEffect, useState } from "react";

/** Formats an ISO timestamp in the viewer's own time zone, e.g. "October 3, 2026". */
export default function LocalDate({ iso }: { iso: string }) {
  const [text, setText] = useState<string>("");
  useEffect(() => {
    const d = new Date(iso);
    setText(
      Number.isNaN(d.getTime())
        ? ""
        : d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }),
    );
  }, [iso]);
  return <time dateTime={iso}>{text || " "}</time>;
}
