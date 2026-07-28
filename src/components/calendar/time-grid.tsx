"use client";

import { useEffect, useRef } from "react";
import { blockGeometry, placeEvents } from "@/lib/layout";
import { DayHeaders } from "./day-headers";
import type { CalDay, CalEvent } from "./types";

/**
 * The hour-by-hour grid, used for both a single day and a whole week — the
 * only difference is how many columns it's handed.
 *
 * At seven columns on a phone each is ~45px, too narrow for a title, so blocks
 * below a readable size stay plain colour bars. That's the point of this view:
 * it shows the *shape* of the time, and tapping opens the detail.
 */

const HOUR_HEIGHT = 48;
const DAY_HEIGHT = HOUR_HEIGHT * 24;
const AXIS_WIDTH = 44;

function hourLabel(hour: number): string {
  if (hour === 0) return "";
  if (hour === 12) return "noon";
  return hour < 12 ? `${hour} AM` : `${hour - 12} PM`;
}

export function TimeGrid({
  days,
  selected,
  onSelect,
  onOpenEvent,
  nowMinutes,
}: {
  days: CalDay[];
  selected: number;
  onSelect: (index: number) => void;
  onOpenEvent: (event: CalEvent) => void;
  /** Minutes into today, or null when today isn't on screen. */
  nowMinutes: number | null;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const single = days.length === 1;

  // Open on the working day rather than at midnight.
  useEffect(() => {
    const starts = days.flatMap((d) =>
      d.events.filter((e) => !e.allDay).map((e) => e.startMinutes),
    );
    const earliest = Math.min(...starts, 8 * 60);
    scroller.current?.scrollTo({
      top: Math.max(0, (earliest / 60) * HOUR_HEIGHT - HOUR_HEIGHT),
    });
  }, [days]);

  const allDayByDay = days.map((d) => d.events.filter((e) => e.allDay));
  const hasAllDay = allDayByDay.some((list) => list.length > 0);

  return (
    <div>
      <DayHeaders
        days={days}
        selected={selected}
        onSelect={onSelect}
        paddingLeft={AXIS_WIDTH}
        showWeekday={!single}
      />

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
                  onClick={() => onOpenEvent(event)}
                  title={event.summary}
                  className="block h-5 w-full truncate rounded px-1 text-left text-[10px] font-medium leading-5 text-white"
                  style={{ backgroundColor: event.color }}
                >
                  {event.summary}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}

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
              const placed = placeEvents(day.events.filter((e) => !e.allDay));
              return (
                <div
                  key={day.day}
                  className={`relative min-w-0 flex-1 border-l border-border ${
                    !single && index === selected ? "bg-surface-muted/60" : ""
                  }`}
                >
                  {placed.map((event) => {
                    const { top, height } = blockGeometry(event);
                    // A block narrower than a character, or shorter than a
                    // line, can't carry text — it stays a colour bar.
                    const showLabel =
                      (single || event.width >= 0.5) &&
                      height * DAY_HEIGHT >= 22;
                    return (
                      <button
                        key={event.key}
                        type="button"
                        onClick={() => onOpenEvent(event)}
                        title={`${event.timeLabel} · ${event.summary}`}
                        aria-label={`${event.timeLabel} ${event.summary}`}
                        className="absolute overflow-hidden rounded-[3px] text-left leading-tight text-white ring-1 ring-inset ring-white/25"
                        style={{
                          top: `${top * 100}%`,
                          height: `${height * 100}%`,
                          left: `${event.left * 100}%`,
                          width: `calc(${event.width * 100}% - 2px)`,
                          backgroundColor: event.color,
                          zIndex: 1 + event.depth,
                        }}
                      >
                        {showLabel && (
                          <span className="block truncate px-1 pt-0.5 text-[10px] font-medium">
                            {single && (
                              <span className="opacity-80">
                                {event.timeLabel}{" "}
                              </span>
                            )}
                            {event.summary}
                          </span>
                        )}
                      </button>
                    );
                  })}

                  {day.isToday && nowMinutes !== null && (
                    <div
                      className="pointer-events-none absolute inset-x-0 z-20 border-t-2 border-red-500"
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
    </div>
  );
}
