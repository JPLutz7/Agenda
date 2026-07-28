"use client";

import type { CalDay } from "./types";

/**
 * The row of tappable dates above a grid.
 *
 * Two different states, deliberately styled differently:
 *   - today is a filled blue circle, and is the *only* blue circle anywhere.
 *     Paging to another week must not leave a blue ring sitting on whatever
 *     weekday happens to be in the same position.
 *   - the day you tapped gets a neutral outline, so you can always see what
 *     the panel below is showing without it competing with today.
 */
export function DayHeaders({
  days,
  selected,
  onSelect,
  paddingLeft = 0,
  showWeekday = true,
}: {
  days: CalDay[];
  selected: number;
  onSelect: (index: number) => void;
  paddingLeft?: number;
  showWeekday?: boolean;
}) {
  return (
    <div className="flex" style={{ paddingLeft }}>
      {days.map((day, index) => {
        const isSelected = index === selected;
        return (
          <button
            key={day.day}
            type="button"
            onClick={() => onSelect(index)}
            aria-pressed={isSelected}
            aria-current={day.isToday ? "date" : undefined}
            aria-label={`${day.weekdayShort} ${day.dayOfMonth}${
              day.isToday ? ", today" : ""
            }`}
            className="flex flex-1 flex-col items-center gap-1 py-1.5"
          >
            {showWeekday && (
              <span
                className={`text-[10px] font-medium uppercase ${
                  day.isToday ? "text-accent" : "text-muted"
                }`}
              >
                {day.weekdayInitial}
              </span>
            )}
            <span
              className={[
                "flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold transition-colors",
                day.isToday
                  ? "bg-accent text-white"
                  : isSelected
                    ? "bg-surface-muted text-foreground ring-2 ring-inset ring-muted"
                    : "text-foreground",
                // Today *and* selected: keep it blue, add the outline.
                day.isToday && isSelected ? "ring-2 ring-accent/40" : "",
              ].join(" ")}
            >
              {day.dayOfMonth}
            </span>
          </button>
        );
      })}
    </div>
  );
}
