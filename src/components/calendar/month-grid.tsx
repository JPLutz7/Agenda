"use client";

import type { CalDay, CalEvent } from "./types";

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];
/** More than this in one cell and the day number stops being readable. */
const MAX_CHIPS = 3;

/**
 * A month at a glance: whole weeks, so the grid is always rectangular, with
 * days from the neighbouring months dimmed rather than left blank.
 *
 * Cells are ~50px wide, which fits a colour bar per event but not a title.
 * Tapping a day fills in the readable list underneath.
 */
export function MonthGrid({
  days,
  selected,
  onSelect,
  onOpenEvent,
}: {
  days: CalDay[];
  selected: number;
  onSelect: (index: number) => void;
  onOpenEvent: (event: CalEvent) => void;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
      <div className="grid grid-cols-7 border-b border-border">
        {WEEKDAYS.map((initial, i) => (
          <div
            key={i}
            className="py-1.5 text-center text-[10px] font-medium uppercase text-muted"
          >
            {initial}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {days.map((day, index) => {
          const isSelected = index === selected;
          const chips = day.events.slice(0, MAX_CHIPS);
          const overflow = day.events.length - chips.length;

          return (
            <div
              key={day.day}
              className={`min-h-[62px] min-w-0 border-b border-l border-border p-0.5 first:border-l-0 ${
                isSelected && !day.isToday ? "bg-surface-muted" : ""
              } ${day.inFocus ? "" : "opacity-40"}`}
            >
              <button
                type="button"
                onClick={() => onSelect(index)}
                aria-pressed={isSelected}
                aria-current={day.isToday ? "date" : undefined}
                aria-label={`${day.weekdayShort} ${day.dayOfMonth}${
                  day.isToday ? ", today" : ""
                }, ${day.events.length} events`}
                className="mx-auto flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold"
              >
                <span
                  className={[
                    "flex h-6 w-6 items-center justify-center rounded-full",
                    day.isToday
                      ? "bg-accent text-white"
                      : isSelected
                        ? "ring-2 ring-inset ring-muted"
                        : "",
                  ].join(" ")}
                >
                  {day.dayOfMonth}
                </span>
              </button>

              <div className="mt-0.5 space-y-[2px]">
                {chips.map((event) => (
                  <button
                    key={event.key}
                    type="button"
                    onClick={() => onOpenEvent(event)}
                    title={`${event.timeLabel} · ${event.summary}`}
                    aria-label={`${event.timeLabel} ${event.summary}`}
                    className="block h-[9px] w-full rounded-[2px]"
                    style={{ backgroundColor: event.color }}
                  />
                ))}
                {overflow > 0 && (
                  <button
                    type="button"
                    onClick={() => onSelect(index)}
                    className="block w-full text-center text-[9px] leading-none text-muted"
                  >
                    +{overflow}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
