"use client";

import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { blockGeometry, placeEvents } from "@/lib/layout";
import { textOn } from "@/lib/colors";
import type { CalDay, CalEvent } from "./types";

/**
 * The hour-by-hour grid, for a single day or a whole week.
 *
 * Seven columns fitted into a 390px phone leaves 45px each — narrower than a
 * word, so titles could only ever be coloured bars. Columns therefore have a
 * minimum readable width and the week scrolls sideways instead, about three
 * days at a time. On anything wider than ~830px all seven fit and the
 * scrolling never happens.
 *
 * The hour axis is pinned to the left and the day headers to the top, so you
 * always know what you're looking at mid-swipe.
 */

const HOUR_HEIGHT = 56;
const DAY_HEIGHT = HOUR_HEIGHT * 24;
const AXIS_WIDTH = 44;
/** Enough for "7 PM" above a few words of title. */
const MIN_COLUMN = 116;
/** Below this a block can't fit two lines, so time and title share one. */
const TWO_LINE_HEIGHT = 34;
/** New events land on a quarter hour rather than 10:23. */
const SLOT_MINUTES = 15;

function hourLabel(hour: number): string {
  if (hour === 0) return "";
  if (hour === 12) return "noon";
  return hour < 12 ? `${hour} AM` : `${hour - 12} PM`;
}

/** Where in the day a click landed, as 'HH:MM' on the nearest quarter hour. */
function timeAt(offsetY: number, height: number): string {
  const raw = (offsetY / height) * 1440;
  const slot = Math.round(raw / SLOT_MINUTES) * SLOT_MINUTES;
  const minutes = Math.max(0, Math.min(1440 - SLOT_MINUTES, slot));
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(
    minutes % 60,
  ).padStart(2, "0")}`;
}

export function TimeGrid({
  days,
  selected,
  onSelect,
  onOpenEvent,
  onCreate,
  nowMinutes,
}: {
  days: CalDay[];
  selected: number;
  onSelect: (index: number) => void;
  onOpenEvent: (event: CalEvent) => void;
  /** Double-clicking an empty spot: the day, and the time pointed at. */
  onCreate: (day: string, time: string) => void;
  nowMinutes: number | null;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const single = days.length === 1;

  /**
   * The week used to carry a blank spacer after the last day so every column
   * could reach a start-aligned snap point. It worked, but it meant scrolling
   * a screen's worth past Sunday into nothing. Snapping the final column to
   * the *end* of the scrollport instead puts a snap point exactly at the
   * furthest scroll, so the grid stops where the week does.
   */
  const lastIndex = days.length - 1;

  /**
   * Double-tap on a touch screen doesn't reliably produce a dblclick, so
   * taps are paired here by time and distance. Mouse double-clicks are left
   * to onDoubleClick, which already knows the platform's timing.
   */
  const lastTap = useRef<{ at: number; x: number; y: number } | null>(null);

  // Open on the working day, and on the selected day horizontally, rather
  // than at midnight on Sunday.
  useEffect(() => {
    const starts = days.flatMap((d) =>
      d.events.filter((e) => !e.allDay).map((e) => e.startMinutes),
    );
    const earliest = Math.min(...starts, 8 * 60);
    const node = scroller.current;
    if (!node) return;
    node.scrollTo({
      top: Math.max(0, (earliest / 60) * HOUR_HEIGHT - HOUR_HEIGHT),
      left: single ? 0 : Math.max(0, selected * MIN_COLUMN - MIN_COLUMN),
    });
    // Only when the period changes — not on every tap, which would yank the
    // grid sideways under the user's finger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days]);

  const allDayByDay = days.map((d) => d.events.filter((e) => e.allDay));
  const hasAllDay = allDayByDay.some((list) => list.length > 0);
  const columnStyle = { flex: `1 0 ${single ? 0 : MIN_COLUMN}px` };
  const snapClass = (index: number) =>
    index === lastIndex ? "snap-end" : "snap-start";

  /** A double-click on empty grid, turned into a day and a time. */
  const createAt = (
    day: string,
    target: HTMLElement,
    clientY: number,
  ) => {
    const box = target.getBoundingClientRect();
    onCreate(day, timeAt(clientY - box.top, box.height));
  };

  const onColumnPointerUp = (
    day: string,
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    // Only the column's own background — a tap on an event opens that event.
    if (event.pointerType === "mouse" || event.target !== event.currentTarget) {
      return;
    }
    const previous = lastTap.current;
    const now = Date.now();
    lastTap.current = { at: now, x: event.clientX, y: event.clientY };
    if (
      previous &&
      now - previous.at < 400 &&
      Math.hypot(event.clientX - previous.x, event.clientY - previous.y) < 30
    ) {
      lastTap.current = null;
      createAt(day, event.currentTarget, event.clientY);
    }
  };

  return (
    <div
      ref={scroller}
      // Snapping to column starts means a day is never left half-scrolled
      // under the pinned hour axis, which would clip the text off its blocks.
      className="relative max-h-[60vh] snap-x snap-mandatory overflow-auto overscroll-contain rounded-xl border border-border bg-surface"
      // Snap points align to the scrollport's edge, which the pinned hour axis
      // sits on top of — so without this, every snap parks a column's first
      // 44px underneath the axis and clips the text off its blocks.
      style={{ scrollPaddingLeft: AXIS_WIDTH }}
    >
      <div className="w-max min-w-full">
        {/* Day headers, pinned to the top of the scroller. */}
        <div className="sticky top-0 z-30 flex border-b border-border bg-surface">
          <div
            className="sticky left-0 z-40 shrink-0 bg-surface"
            style={{ width: AXIS_WIDTH }}
          />
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
                className={`flex min-w-0 flex-col items-center gap-0.5 border-l border-border py-1.5 ${snapClass(
                  index,
                )}`}
                style={columnStyle}
              >
                <span
                  className={`text-[10px] font-medium uppercase ${
                    day.isToday ? "text-accent" : "text-muted"
                  }`}
                >
                  {single ? day.weekdayShort : day.weekdayInitial}
                </span>
                <span
                  className={[
                    "flex h-7 w-7 items-center justify-center rounded-full text-sm font-semibold",
                    day.isToday
                      ? "bg-accent text-white"
                      : isSelected
                        ? "bg-surface-muted ring-2 ring-inset ring-muted"
                        : "",
                  ].join(" ")}
                >
                  {day.dayOfMonth}
                </span>
              </button>
            );
          })}
        </div>

        {hasAllDay && (
          <div className="flex border-b border-border bg-surface-muted">
            <div
              className="sticky left-0 z-20 shrink-0 bg-surface-muted pr-1 text-right text-[9px] leading-5 text-muted"
              style={{ width: AXIS_WIDTH }}
            >
              all-day
            </div>
            {allDayByDay.map((list, index) => (
              <div
                key={days[index].day}
                className="min-w-0 space-y-0.5 border-l border-border p-0.5"
                style={columnStyle}
              >
                {list.map((event) => (
                  <button
                    key={event.key}
                    type="button"
                    onClick={() => onOpenEvent(event)}
                    title={event.summary}
                    className="block h-5 w-full truncate rounded px-1 text-left text-[11px] font-medium leading-5"
                    style={{
                      backgroundColor: event.color,
                      color: textOn(event.color),
                    }}
                  >
                    {event.summary}
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}

        <div className="relative flex" style={{ height: DAY_HEIGHT }}>
          <div
            className="sticky left-0 z-20 shrink-0 bg-surface"
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
                  onDoubleClick={(e) => {
                    if (e.target !== e.currentTarget) return;
                    createAt(day.day, e.currentTarget, e.clientY);
                  }}
                  onPointerUp={(e) => onColumnPointerUp(day.day, e)}
                  className={`relative min-w-0 border-l border-border ${snapClass(
                    index,
                  )} ${!single && index === selected ? "bg-surface-muted/50" : ""}`}
                  style={columnStyle}
                >
                  {placed.map((event) => {
                    const { top, height } = blockGeometry(event);
                    const twoLines = height * DAY_HEIGHT >= TWO_LINE_HEIGHT;
                    return (
                      <button
                        key={event.key}
                        type="button"
                        onClick={() => onOpenEvent(event)}
                        title={`${event.timeLabel} · ${event.summary}`}
                        aria-label={`${event.timeLabel} ${event.summary}`}
                        className="absolute overflow-hidden rounded px-1 py-px text-left leading-tight ring-1 ring-inset ring-white/25"
                        style={{
                          top: `${top * 100}%`,
                          height: `${height * 100}%`,
                          left: `${event.left * 100}%`,
                          width: `calc(${event.width * 100}% - 2px)`,
                          backgroundColor: event.color,
                          color: textOn(event.color),
                          zIndex: 1 + event.column,
                        }}
                      >
                        {twoLines ? (
                          <>
                            <span className="block truncate text-[10px] opacity-90">
                              {event.timeLabel}
                            </span>
                            <span className="block truncate text-[11px] font-medium">
                              {event.summary}
                            </span>
                          </>
                        ) : (
                          // Too short for two lines, so combine rather than
                          // dropping either one.
                          <span className="block truncate text-[10px] font-medium">
                            <span className="opacity-90">
                              {event.compactTimeLabel}
                            </span>{" "}
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
