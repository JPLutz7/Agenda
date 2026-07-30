"use client";

import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { blockGeometry, placeEvents } from "@/lib/layout";
import { tintedBlock } from "@/components/ui";
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
/**
 * Hour labels are centred on their line, so landing exactly on one puts half
 * the label above the top edge — which reads as a rendering fault rather than
 * as scroll position. A few pixels of clearance is all it takes.
 */
const LABEL_CLEARANCE = 10;
const DAY_HEIGHT = HOUR_HEIGHT * 24;
const AXIS_WIDTH = 44;
/** Enough for "7 PM" above a few words of title. */
const MIN_COLUMN = 116;
/** The "+2 more" chip. Short enough to sit below the titles it crosses. */
const CHIP_HEIGHT = 14;
/** Below this a block can't fit two lines, so time and title share one. */
const TWO_LINE_HEIGHT = 34;
/** New events land on a quarter hour rather than 10:23. */
const SLOT_MINUTES = 15;

/**
 * How long the grid waits before treating the next wheel event as a new
 * gesture. A trackpad fires every few milliseconds while a finger is down and
 * keeps firing through the momentum afterwards, so this only has to be longer
 * than that stream's own gaps and shorter than a pause a person would notice.
 */
const GESTURE_GAP_MS = 180;
/**
 * How hard you have to push sideways before the grid accepts that you meant it.
 * Roughly a deliberate flick; the few pixels that ride along with a vertical
 * scroll are nowhere near.
 */
const SIDEWAYS_FLOOR = 18;
/**
 * How far sideways one gesture takes you: exactly one day, however hard it was
 * thrown.
 *
 * Damping the movement instead — scrolling by some fraction of the delta — does
 * not work here, and the reason is worth writing down. The grid is
 * `scroll-snap-type: x mandatory`, and a *programmatic* scroll gets snapped the
 * moment it's made. So each damped nudge lands short of the next column, is
 * pulled straight back to the one it started on, and forty of them in a row add
 * up to nothing at all. Native wheel scrolling escapes this because the browser
 * treats the whole gesture as one scroll and snaps once at the end.
 *
 * One column per gesture is what's left, and it's the better answer anyway:
 * a flick moves one day, every time, no matter how hard you flicked. Two days
 * needs two flicks, and the day headers jump straight to any of them.
 */
const DAYS_PER_GESTURE = 1;

/**
 * The hour lines, painted into each day column rather than laid over all of
 * them at once.
 *
 * One absolutely-positioned overlay across the whole week is the obvious way
 * to draw these, and it measures correctly in Chrome — but the row it sits in
 * is a flex item whose content is wider than the scrollport, and Safari sizes
 * that item to the visible width instead. The lines then stop partway across
 * the week, which is exactly what an iPhone showed. A background on each
 * column can't disagree with the column it's painted on.
 */
const HOUR_LINES = `repeating-linear-gradient(
  to bottom,
  var(--border) 0px,
  var(--border) 1px,
  transparent 1px,
  transparent ${HOUR_HEIGHT}px
)`;

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

  /** The crowd behind a tapped "+2 more" chip. */
  const [more, setMore] = useState<CalEvent[] | null>(null);

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
      top: Math.max(
        0,
        (earliest / 60) * HOUR_HEIGHT - HOUR_HEIGHT - LABEL_CLEARANCE,
      ),
      left: single ? 0 : Math.max(0, selected * MIN_COLUMN - MIN_COLUMN),
    });
    // Paging to another week leaves the list holding last week's events.
    setMore(null);
    // Only when the period changes — not on every tap, which would yank the
    // grid sideways under the user's finger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days]);

  /**
   * Which way a scroll gesture is going, decided once and then held.
   *
   * A trackpad reports both axes on almost every scroll — run a finger down it
   * and a few pixels of `deltaX` come along for the ride. The grid snaps to
   * whole day columns, so those stray pixels don't drift, they *commit*: the
   * week jumps a day sideways while you were only trying to get from morning to
   * afternoon.
   *
   * Comparing the two deltas on each event is the obvious fix and it isn't
   * enough. As a scroll's momentum dies away `deltaY` decays to 1 or 2 while
   * `deltaX` stays at 3 or 4, so "sideways is bigger than vertical" becomes
   * *easier* to satisfy the longer you leave the grid alone — and each of those
   * tiny events still buys a whole column. That was the hole in the first
   * version of this, and it's why the jumping carried on.
   *
   * So the axis is decided once, at the start of a gesture, and held until the
   * gesture actually stops (nothing for {@link GESTURE_GAP_MS}). Begin scrolling
   * down and it stays a downward scroll however much the trackpad wobbles, all
   * the way through the momentum. Deciding it also takes a real shove sideways —
   * {@link SIDEWAYS_FLOOR} pixels, not three — so noise can't start a horizontal
   * gesture either.
   *
   * Attached here rather than with onWheel because React's wheel listener is
   * passive, and a passive listener is not allowed to call preventDefault.
   */
  useEffect(() => {
    const node = scroller.current;
    if (!node) return;

    let axis: "x" | "y" | null = null;
    let lastEventAt = 0;
    /** Whether this gesture has already had its one day. */
    let stepped = false;

    const onWheel = (event: WheelEvent) => {
      const now = event.timeStamp;
      if (now - lastEventAt > GESTURE_GAP_MS) {
        axis = null;
        stepped = false;
      }
      lastEventAt = now;

      const sideways = Math.abs(event.deltaX);
      const vertical = Math.abs(event.deltaY);

      if (axis === null) {
        if (sideways >= SIDEWAYS_FLOOR && sideways > vertical * 2) axis = "x";
        else if (vertical > 0 || sideways > 0) axis = "y";
        else return;
      }

      if (axis === "y") {
        // Nothing to correct on a purely vertical event: let the browser do it,
        // which keeps its own smoothing rather than replacing it with ours.
        if (event.deltaX === 0) return;
        event.preventDefault();
        node.scrollTop += event.deltaY;
        return;
      }

      // Sideways, and meant. One day, then nothing more until the gesture ends
      // — the rest of a flick and all of its momentum are ignored, which is the
      // whole point: a hard throw and a gentle push do the same thing.
      event.preventDefault();
      if (stepped) return;
      stepped = true;
      node.scrollBy({
        left: Math.sign(event.deltaX) * DAYS_PER_GESTURE * MIN_COLUMN,
        behavior: "smooth",
      });
    };

    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, []);

  const allDayByDay = days.map((d) => d.events.filter((e) => e.allDay));
  const hasAllDay = allDayByDay.some((list) => list.length > 0);
  const columnStyle = { flex: `1 0 ${single ? 0 : MIN_COLUMN}px` };
  const snapClass = (index: number) =>
    index === lastIndex ? "snap-end" : "snap-start";

  /** A double-click on empty grid, turned into a day and a time. */
  const createAt = (day: string, target: HTMLElement, clientY: number) => {
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
    <>
    <div
      ref={scroller}
      // Named so a test can measure what this actually scrolled to. Nothing in
      // the app reads it.
      data-scroller=""
      // Snapping to column starts means a day is never left half-scrolled
      // under the pinned hour axis, which would clip the text off its blocks.
      className="relative max-h-[60vh] snap-x snap-mandatory overflow-auto overscroll-contain rounded-xl border border-border bg-surface"
      // Snap points align to the scrollport's edge, which the pinned hour axis
      // sits on top of — so without this, every snap parks a column's first
      // 44px underneath the axis and clips the text off its blocks.
      style={{ scrollPaddingLeft: AXIS_WIDTH }}
    >
      {/* The width is stated rather than left to `w-max`. Safari resolves
          max-content here to the scrollport's width, so every row inside was
          356px wide against the week's real 856 — and a row's background or
          border stopped partway across, leaving the pinned header's underline
          hanging in mid-air. min-width keeps a wide screen able to stretch. */}
      <div
        className="w-full"
        style={
          single
            ? undefined
            : { minWidth: AXIS_WIDTH + days.length * MIN_COLUMN }
        }
      >
        {/* Headers and all-day events pin together as one band. The all-day
            row used to scroll with the grid, so opening on the morning hours
            scrolled an all-day event straight out of sight — which for a
            chore, whose whole existence on the calendar is that row, meant it
            may as well not have been there. */}
        <div className="sticky top-0 z-30 bg-surface">
        <div className="flex border-b border-border bg-surface">
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
                    // Timed blocks carry one too; without it a screen reader
                    // reads an all-day chip as an unlabelled button.
                    aria-label={`All day: ${event.summary}`}
                    className="block h-5 w-full truncate rounded-sm px-1.5 text-left text-[11px] font-medium leading-5"
                    style={tintedBlock(event.color)}
                  >
                    {event.summary}
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
        </div>

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

          {/* The day columns sit directly in this row rather than in a
              wrapper of their own: a nested flex item measured 312px in
              Safari against 812 in Chrome, and anything positioned against
              it inherited the mistake. */}
          {days.map((day, index) => {
            const { placed, overflow } = placeEvents(
              day.events.filter((e) => !e.allDay),
            );
            return (
              <div
                key={day.day}
                onDoubleClick={(e) => {
                  if (e.target !== e.currentTarget) return;
                  createAt(day.day, e.currentTarget, e.clientY);
                }}
                onPointerUp={(e) => onColumnPointerUp(day.day, e)}
                // z-0 rather than the default auto, so a column always stays
                // under the pinned header and the hour axis.
                className={`relative z-0 min-w-0 border-l border-border ${snapClass(
                  index,
                )} ${!single && index === selected ? "bg-surface-muted/50" : ""}`}
                style={{ ...columnStyle, backgroundImage: HOUR_LINES }}
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
                      className="absolute overflow-hidden rounded-sm px-1.5 py-px text-left leading-tight"
                      style={{
                        ...tintedBlock(event.color),
                        top: `${top * 100}%`,
                        height: `${height * 100}%`,
                        left: `${event.left * 100}%`,
                        width: `calc(${event.width * 100}% - 2px)`,
                        zIndex: 1 + event.column,
                      }}
                    >
                      {twoLines ? (
                        <>
                          <span className="block truncate text-[10px] text-muted">
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

                {/* What a fourth overlapping event turns into. Anchored to the
                    bottom of the crowd and hanging upwards, so it crosses the
                    empty tail of the blocks beside it rather than their
                    titles. z-10 keeps it above every block (which top out at
                    z-3) and below the now line (z-20). */}
                {overflow.map((group) => (
                  <button
                    key={group.key}
                    type="button"
                    onClick={() => setMore(group.events)}
                    title={group.events.map((e) => e.summary).join(", ")}
                    aria-label={`Show ${group.events.length} more event${
                      group.events.length === 1 ? "" : "s"
                    }`}
                    className="absolute left-0 right-0.5 z-10 truncate rounded border border-border bg-surface text-center text-[9px] font-semibold text-muted shadow-sm hover:text-foreground"
                    style={{
                      top: `${group.at * 100}%`,
                      height: CHIP_HEIGHT,
                      lineHeight: `${CHIP_HEIGHT - 2}px`,
                      marginTop: -CHIP_HEIGHT,
                    }}
                  >
                    +{group.events.length} more
                  </button>
                ))}

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

    <MoreEventsDialog
      events={more}
      onPick={(event) => {
        setMore(null);
        onOpenEvent(event);
      }}
      onClose={() => setMore(null)}
    />
    </>
  );
}

/**
 * The events a "+2 more" chip is standing in for.
 *
 * A crowded stretch of the week can only ever be summarised on the grid
 * itself, so the chip has to lead somewhere that says which events they are —
 * at their full titles, with their times, in the same colours. Picking one
 * closes this and opens the ordinary event detail, so nothing about a hidden
 * event is second-class once you've found it.
 */
function MoreEventsDialog({
  events,
  onPick,
  onClose,
}: {
  events: CalEvent[] | null;
  onPick: (event: CalEvent) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (events && !dialog.open) dialog.showModal();
    if (!events && dialog.open) dialog.close();
  }, [events]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      // m-auto centres it: the Tailwind reset zeroes the margin a <dialog>
      // would otherwise use to centre itself, pinning it to the top.
      className="m-auto w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-border bg-surface p-0 text-foreground backdrop:bg-black/40"
    >
      {events && (
        <div className="p-5">
          <h2 className="text-base font-semibold leading-snug">
            Also at this time
          </h2>
          <p className="mt-1 text-xs text-muted">{events[0].dateLabel}</p>

          <ul className="mt-4 space-y-1">
            {events.map((event) => (
              <li key={event.key}>
                <button
                  type="button"
                  onClick={() => onPick(event)}
                  className="flex w-full items-center gap-2.5 rounded-lg border border-border bg-surface-muted px-3 py-2 text-left hover:border-muted"
                >
                  <span
                    aria-hidden="true"
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: event.color }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {event.summary}
                    </span>
                    <span className="block truncate text-xs text-muted">
                      {event.rangeLabel}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>

          <div className="mt-5 text-right">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-border bg-surface-muted px-4 py-2 text-sm font-medium"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}
