"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { blockGeometry, placeEvents } from "@/lib/layout";

/**
 * The week, as a grid rather than a list.
 *
 * A phone is only ~390px wide, so seven columns leaves about 45px each. That's
 * too narrow to read an event title in full, and that's fine — the grid's job
 * is to show the *shape* of the week at a glance: when you're busy, when you're
 * both free, where the gaps are. Tapping a day fills in the detail underneath,
 * where there's room to read.
 */

export type GridEvent = {
  key: string;
  summary: string;
  color: string;
  allDay: boolean;
  startMinutes: number;
  endMinutes: number;
  timeLabel: string;
};

export type GridDay = {
  day: string;
  weekdayInitial: string;
  dayOfMonth: string;
  isToday: boolean;
  events: GridEvent[];
};

const HOUR_HEIGHT = 48;
const DAY_HEIGHT = HOUR_HEIGHT * 24;
const AXIS_WIDTH = 44;

function hourLabel(hour: number): string {
  if (hour === 0 || hour === 24) return "";
  if (hour === 12) return "noon";
  return hour < 12 ? `${hour} AM` : `${hour - 12} PM`;
}

export function WeekCalendar({
  days,
  dayPanels,
  initialSelected,
  nowMinutes,
}: {
  days: GridDay[];
  /** One rendered panel per day, in the same order as `days`. */
  dayPanels: ReactNode[];
  initialSelected: number;
  /** Minutes into today, or null when today isn't in this week. */
  nowMinutes: number | null;
}) {
  const [selected, setSelected] = useState(initialSelected);
  const scroller = useRef<HTMLDivElement>(null);

  // Open on the working day rather than at midnight, which is otherwise all
  // you'd see: scroll to the earliest event, or 8am if the week is empty.
  useEffect(() => {
    const earliest = Math.min(
      ...days.flatMap((d) =>
        d.events.filter((e) => !e.allDay).map((e) => e.startMinutes),
      ),
      8 * 60,
    );
    const target = Math.max(0, (earliest / 60) * HOUR_HEIGHT - HOUR_HEIGHT);
    scroller.current?.scrollTo({ top: target });
  }, [days]);

  const allDayByDay = days.map((d) => d.events.filter((e) => e.allDay));
  const hasAllDay = allDayByDay.some((list) => list.length > 0);

  return (
    <div>
      {/* Day headers — the tap targets for choosing a day. */}
      <div className="flex" style={{ paddingLeft: AXIS_WIDTH }}>
        {days.map((day, index) => {
          const isSelected = index === selected;
          return (
            <button
              key={day.day}
              type="button"
              onClick={() => setSelected(index)}
              aria-pressed={isSelected}
              aria-label={`${day.weekdayInitial} ${day.dayOfMonth}, ${day.events.length} events`}
              className="flex flex-1 flex-col items-center gap-1 py-1.5"
            >
              <span
                className={`text-[10px] font-medium uppercase ${
                  day.isToday ? "text-accent" : "text-muted"
                }`}
              >
                {day.weekdayInitial}
              </span>
              <span
                className={`flex h-7 w-7 items-center justify-center rounded-full text-sm font-semibold transition-colors ${
                  isSelected
                    ? "bg-accent text-white"
                    : day.isToday
                      ? "text-accent"
                      : "text-foreground"
                }`}
              >
                {day.dayOfMonth}
              </span>
            </button>
          );
        })}
      </div>

      {hasAllDay && (
        <div
          className="flex border-y border-border bg-surface-muted"
          style={{ paddingLeft: AXIS_WIDTH }}
        >
          {allDayByDay.map((list, index) => (
            <div
              key={days[index].day}
              className="min-w-0 flex-1 space-y-0.5 border-l border-border p-0.5"
            >
              {list.map((event) => (
                <button
                  key={event.key}
                  type="button"
                  onClick={() => setSelected(index)}
                  title={event.summary}
                  aria-label={`All day: ${event.summary}`}
                  className="block h-4 w-full truncate rounded px-1 text-left text-[10px] font-medium leading-4 text-white"
                  style={{ backgroundColor: event.color }}
                >
                  {event.summary}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* The grid. Scrolls vertically through the day; never sideways. */}
      <div
        ref={scroller}
        className="relative max-h-[52vh] overflow-y-auto overscroll-contain rounded-xl border border-border bg-surface"
      >
        <div className="relative flex" style={{ height: DAY_HEIGHT }}>
          <div
            className="relative shrink-0"
            style={{ width: AXIS_WIDTH }}
            aria-hidden="true"
          >
            {Array.from({ length: 24 }, (_, hour) => (
              <div
                key={hour}
                className="absolute right-1 -translate-y-1/2 text-[10px] text-muted"
                style={{ top: hour * HOUR_HEIGHT }}
              >
                {hourLabel(hour)}
              </div>
            ))}
          </div>

          <div className="relative flex flex-1">
            {/* Hour lines, behind everything. */}
            <div className="pointer-events-none absolute inset-0">
              {Array.from({ length: 24 }, (_, hour) => (
                <div
                  key={hour}
                  className="absolute inset-x-0 border-t border-border"
                  style={{ top: hour * HOUR_HEIGHT }}
                />
              ))}
            </div>

            {days.map((day, index) => {
              const timed = day.events.filter((e) => !e.allDay);
              const placed = placeEvents(timed);
              return (
                <div
                  key={day.day}
                  className={`relative min-w-0 flex-1 border-l border-border ${
                    index === selected ? "bg-accent/5" : ""
                  }`}
                >
                  {placed.map((event) => {
                    const { top, height } = blockGeometry(event);
                    // A 45px column split three ways leaves ~15px — narrower
                    // than a single character. Below these thresholds the
                    // block stays a plain colour bar: still visible, still
                    // tappable, and the day panel below carries the words.
                    const heightPx = height * DAY_HEIGHT;
                    const showLabel = event.width >= 0.5 && heightPx >= 22;
                    return (
                      <button
                        key={event.key}
                        type="button"
                        onClick={() => setSelected(index)}
                        title={`${event.timeLabel} · ${event.summary}`}
                        aria-label={`${event.timeLabel} ${event.summary}`}
                        className="absolute overflow-hidden rounded-[3px] text-left leading-tight text-white ring-1 ring-inset ring-white/25"
                        style={{
                          top: `${top * 100}%`,
                          height: `${height * 100}%`,
                          left: `${event.left * 100}%`,
                          width: `calc(${event.width * 100}% - 2px)`,
                          backgroundColor: event.color,
                          // Later events sit on top of the ones they overlap,
                          // which is what makes the staircase read correctly.
                          zIndex: 1 + event.depth,
                        }}
                      >
                        {showLabel && (
                          // Truncate on one line rather than wrapping: a
                          // narrow column turns "Office" into "Offi ce".
                          <span className="block truncate px-1 pt-0.5 text-[10px] font-medium">
                            {event.summary}
                          </span>
                        )}
                      </button>
                    );
                  })}

                  {day.isToday && nowMinutes !== null && (
                    <div
                      className="pointer-events-none absolute inset-x-0 z-10 border-t-2 border-red-500"
                      style={{ top: `${(nowMinutes / 1440) * 100}%` }}
                    >
                      <span className="absolute -left-1 -top-[3px] h-1.5 w-1.5 rounded-full bg-red-500" />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Detail for the chosen day, pre-rendered on the server so the delete
          buttons stay real forms rather than needing client-side wiring. */}
      <div className="mt-5">
        {dayPanels.map((panel, index) => (
          <div key={days[index].day} hidden={index !== selected}>
            {panel}
          </div>
        ))}
      </div>
    </div>
  );
}
