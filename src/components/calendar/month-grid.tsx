"use client";

import { useRef } from "react";
import { tintedBlock } from "@/components/ui";
import type { CalDay, CalEvent } from "./types";

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];
/**
 * Two, because each chip carries the time *and* the title on separate lines.
 * Sharing one line in a ~46px cell left the title about two characters — the
 * time was legible and the title may as well not have been there.
 */
const MAX_CHIPS = 2;

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
  onCreate,
}: {
  days: CalDay[];
  selected: number;
  onSelect: (index: number) => void;
  onOpenEvent: (event: CalEvent) => void;
  /** Double-clicking a day. A month cell carries no time of day. */
  onCreate: (day: string) => void;
}) {
  // Touch screens don't reliably fire dblclick, so taps are paired by hand.
  const lastTap = useRef<{ at: number; day: string } | null>(null);
  const onCellPointerUp = (
    day: string,
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    if (event.pointerType === "mouse") return;
    const previous = lastTap.current;
    const now = Date.now();
    lastTap.current = { at: now, day };
    if (previous && previous.day === day && now - previous.at < 400) {
      lastTap.current = null;
      onCreate(day);
    }
  };

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
              onDoubleClick={() => onCreate(day.day)}
              onPointerUp={(e) => onCellPointerUp(day.day, e)}
              className={`min-h-[92px] min-w-0 border-b border-l border-border p-0.5 first:border-l-0 ${
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
                    className="block w-full rounded-[2px] px-1 py-px text-left text-[8px] leading-[10px]"
                    style={tintedBlock(event.color)}
                  >
                    {/* A month cell is ~46px wide. The time is abbreviated to
                        '7p' and given its own line so the title gets the full
                        width rather than the few characters left over. */}
                    <span className="block truncate text-muted">
                      {event.allDay ? "all day" : event.compactTimeLabel}
                    </span>
                    <span className="block truncate font-medium">
                      {event.summary}
                    </span>
                  </button>
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
