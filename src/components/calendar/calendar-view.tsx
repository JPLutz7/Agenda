"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import {
  AddEventDialog,
  AddDormEventForm,
  type AddEventOptions,
} from "@/components/add-event-form";
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
  addOptions,
  dayLabels,
  editId,
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
  /** Everything the add-event form needs, resolved on the server. */
  addOptions: AddEventOptions;
  /** 'Tuesday, July 28, 2026' for each day on screen, keyed by day. */
  dayLabels: Record<string, string>;
  /**
   * A dorm event to open straight into its edit form, from `?edit=` —
   * how the Today screen's pencil gets you here without a second tap.
   */
  editId: number | null;
}) {
  const router = useRouter();

  // Read once, on mount. A later router.refresh() re-renders this component
  // without remounting it, and re-opening the dialog every 45 seconds because
  // the URL still says `edit=` would be unusable.
  const [openEvent, setOpenEvent] = useState<CalEvent | null>(() =>
    editId === null
      ? null
      : (days.flatMap((d) => d.events).find((e) => e.edit?.id === editId) ??
        null),
  );
  const [editing, setEditing] = useState(() => openEvent !== null);
  /** The spot double-clicked on the grid, waiting to become an event. */
  const [draft, setDraft] = useState<{ date: string; time: string | null } | null>(
    null,
  );

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

  // Always land on the details first; editing is a deliberate second tap.
  const openDetails = (event: CalEvent) => {
    setOpenEvent(event);
    setEditing(false);
  };

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
          onOpenEvent={openDetails}
          onCreate={(day) => setDraft({ date: day, time: null })}
        />
      ) : (
        <TimeGrid
          days={days}
          selected={selected}
          onSelect={setSelected}
          onOpenEvent={openDetails}
          onCreate={(day, time) => setDraft({ date: day, time })}
          nowMinutes={nowMinutes}
        />
      )}

      {scale !== "year" && (
        <p className="mt-2 px-1 text-xs text-muted">
          Double-tap (or double-click) an empty spot to add something there.
        </p>
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

      {scale !== "year" && (
        <div className="mt-5">
          <AddDormEventForm {...addOptions} defaultDate={anchor} />
        </div>
      )}

      <EventModal
        event={openEvent}
        addOptions={addOptions}
        editing={editing}
        onEditingChange={setEditing}
        onClose={() => {
          setOpenEvent(null);
          setEditing(false);
        }}
      />

      <AddEventDialog
        {...addOptions}
        // A fresh form per spot: the previous one's time would otherwise
        // linger in the fields.
        key={draft ? `${draft.date}T${draft.time ?? ""}` : "none"}
        open={draft !== null}
        date={draft?.date ?? anchor}
        time={draft?.time ?? null}
        dateLabel={draft ? (dayLabels[draft.date] ?? draft.date) : ""}
        onClose={() => setDraft(null)}
      />
    </div>
  );
}
