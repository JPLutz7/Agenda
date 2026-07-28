"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { EventModal } from "./event-modal";
import { MonthGrid } from "./month-grid";
import { TimeGrid } from "./time-grid";
import { YearGrid } from "./year-grid";
import { SCALES, type CalDay, type CalEvent, type CalendarScale } from "./types";

const SCALE_LABELS: Record<CalendarScale, string> = {
  day: "Day",
  week: "Week",
  month: "Month",
  year: "Year",
};

/**
 * The calendar shell: how far you're zoomed out, where you are, and what
 * you've tapped.
 *
 * The scale and the date live in the URL so that paging and zooming are plain
 * navigations the server can answer — which keeps every view server-rendered
 * and means the back button behaves. Only the selected day and the open event
 * are local state, because neither is worth a round trip.
 */
export function CalendarView({
  scale,
  anchor,
  today,
  days,
  dayPanels,
  periodLabel,
  prevHref,
  nextHref,
  todayHref,
  nowMinutes,
  isCurrentPeriod,
}: {
  scale: CalendarScale;
  anchor: string;
  today: string;
  days: CalDay[];
  dayPanels: ReactNode[];
  periodLabel: string;
  prevHref: string;
  nextHref: string;
  todayHref: string;
  nowMinutes: number | null;
  isCurrentPeriod: boolean;
}) {
  const router = useRouter();
  const [openEvent, setOpenEvent] = useState<CalEvent | null>(null);

  // Land on today when it's on screen; otherwise the first day of the period,
  // so the panel underneath always has something to show.
  const defaultSelected = Math.max(
    0,
    days.findIndex((d) => d.day === today),
  );
  const [selected, setSelected] = useState(defaultSelected);

  // Paging to another period re-renders with different days; the old index
  // would otherwise point at an unrelated date.
  useEffect(() => {
    setSelected(defaultSelected);
  }, [anchor, scale, defaultSelected]);

  const go = (nextScale: CalendarScale, date: string) =>
    router.push(`/calendar?view=${nextScale}&date=${date}`);

  return (
    <div>
      {/* Zoom. */}
      <div
        role="tablist"
        aria-label="Calendar scale"
        className="mb-3 flex rounded-lg border border-border bg-surface p-0.5"
      >
        {SCALES.map((option) => (
          <button
            key={option}
            role="tab"
            aria-selected={option === scale}
            onClick={() => go(option, anchor)}
            className={`flex-1 rounded-md px-2 py-1.5 text-sm font-medium transition-colors ${
              option === scale
                ? "bg-accent text-white"
                : "text-muted hover:text-foreground"
            }`}
          >
            {SCALE_LABELS[option]}
          </button>
        ))}
      </div>

      <nav className="mb-3 flex items-center gap-2">
        <button
          type="button"
          onClick={() => router.push(prevHref)}
          aria-label={`Previous ${scale}`}
          className="rounded-lg border border-border bg-surface px-3 py-2 text-sm hover:border-muted"
        >
          ←
        </button>
        <div className="min-w-0 flex-1 truncate text-center text-sm font-medium">
          {periodLabel}
        </div>
        <button
          type="button"
          onClick={() => router.push(nextHref)}
          aria-label={`Next ${scale}`}
          className="rounded-lg border border-border bg-surface px-3 py-2 text-sm hover:border-muted"
        >
          →
        </button>
        {!isCurrentPeriod && (
          <button
            type="button"
            onClick={() => router.push(todayHref)}
            className="rounded-lg border border-border bg-surface px-3 py-2 text-sm hover:border-muted"
          >
            Today
          </button>
        )}
      </nav>

      {scale === "year" ? (
        <YearGrid
          year={anchor}
          today={today}
          onPickMonth={(month) => go("month", month)}
        />
      ) : scale === "month" ? (
        <MonthGrid
          days={days}
          selected={selected}
          onSelect={setSelected}
          onOpenEvent={setOpenEvent}
        />
      ) : (
        <TimeGrid
          days={days}
          selected={selected}
          onSelect={setSelected}
          onOpenEvent={setOpenEvent}
          nowMinutes={nowMinutes}
        />
      )}

      {scale !== "year" && (
        <div className="mt-5">
          {dayPanels.map((panel, index) => (
            <div key={days[index].day} hidden={index !== selected}>
              {panel}
            </div>
          ))}
        </div>
      )}

      <EventModal event={openEvent} onClose={() => setOpenEvent(null)} />
    </div>
  );
}
