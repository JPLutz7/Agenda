import { requireSignedIn } from "@/lib/guard";
import { getEvents, getPeople, groupByDay, timezone } from "@/lib/data";
import { refreshIfStale } from "@/lib/sync";
import {
  addDays,
  addMonths,
  addYears,
  formatDayLabel,
  formatDayShort,
  formatFullDate,
  formatMonthLabel,
  formatTime,
  formatTimeCompact,
  formatTimeRange,
  isSameMonth,
  minutesIntoDay,
  monthGridRange,
  startOfMonth,
  startOfWeek,
  today as todayIn,
  weekdayOf,
} from "@/lib/dates";
import { EventRow } from "@/components/event-list";
import { CalendarView } from "@/components/calendar/calendar-view";
import {
  SCALES,
  type CalDay,
  type CalEvent,
  type CalendarScale,
} from "@/components/calendar/types";
import { PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

const WEEKDAY_INITIALS = ["S", "M", "T", "W", "T", "F", "S"];
const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** The span each scale covers, and how paging moves through it. */
function periodFor(scale: CalendarScale, anchor: string) {
  switch (scale) {
    case "day":
      return {
        from: anchor,
        to: anchor,
        prev: addDays(anchor, -1),
        next: addDays(anchor, 1),
      };
    case "week": {
      const from = startOfWeek(anchor);
      return {
        from,
        to: addDays(from, 6),
        prev: addDays(from, -7),
        next: addDays(from, 7),
      };
    }
    case "month": {
      const { from, to } = monthGridRange(anchor);
      return {
        from,
        to,
        prev: addMonths(startOfMonth(anchor), -1),
        next: addMonths(startOfMonth(anchor), 1),
      };
    }
    case "year":
      // Year view is navigation only — it shows no events, so no range.
      return {
        from: anchor,
        to: anchor,
        prev: addYears(anchor, -1),
        next: addYears(anchor, 1),
      };
  }
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; date?: string }>;
}) {
  await requireSignedIn();
  refreshIfStale();

  const tz = timezone();
  const params = await searchParams;
  const now = todayIn(tz);

  const scale: CalendarScale = SCALES.includes(params.view as CalendarScale)
    ? (params.view as CalendarScale)
    : "week";
  const anchor = /^\d{4}-\d{2}-\d{2}$/.test(params.date ?? "")
    ? params.date!
    : now;

  const { from, to, prev, next } = periodFor(scale, anchor);

  // Year view needs no events, and asking for a year of them would be wasted
  // work — it only ever shows month names and today.
  const grouped =
    scale === "year" ? [] : groupByDay(getEvents(from, to), from, to);

  const toCalEvent = (
    event: ReturnType<typeof getEvents>[number],
    day: string,
  ): CalEvent => {
    const startMinutes = event.allDay ? 0 : minutesIntoDay(event.startsAt, tz);
    const rawEnd = event.allDay ? 1440 : minutesIntoDay(event.endsAt, tz);
    // An event finishing after midnight is clamped to its own day rather than
    // bleeding into the next column.
    const endMinutes = !event.allDay && rawEnd <= startMinutes ? 1440 : rawEnd;
    return {
      key: event.key,
      day,
      summary: event.summary,
      color: event.color,
      personName: event.personName,
      location: event.location,
      allDay: event.allDay,
      startMinutes,
      endMinutes,
      timeLabel: event.allDay ? "All day" : formatTime(event.startsAt, tz),
      compactTimeLabel: event.allDay
        ? "All day"
        : formatTimeCompact(event.startsAt, tz),
      rangeLabel: formatTimeRange(
        event.startsAt,
        event.endsAt,
        event.allDay,
        tz,
      ),
      dateLabel: formatFullDate(day),
      source: event.source,
      householdId: event.householdId,
    };
  };

  const days: CalDay[] = grouped.map(({ day, events }) => ({
    day,
    weekdayInitial: WEEKDAY_INITIALS[weekdayOf(day)],
    weekdayShort: WEEKDAY_SHORT[weekdayOf(day)],
    dayOfMonth: String(Number(day.slice(8, 10))),
    isToday: day === now,
    inFocus: scale === "month" ? isSameMonth(day, anchor) : true,
    events: events.map((event) => toCalEvent(event, day)),
  }));

  const dayPanels = grouped.map(({ day, events }) => (
    <section key={day}>
      <h2 className="mb-2 px-1 text-sm font-semibold">
        {formatDayLabel(day, tz)}
      </h2>
      {events.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted">
          Nothing scheduled.
        </p>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
          {events.map((event) => (
            <EventRow key={event.key} event={event} timeZone={tz} />
          ))}
        </ul>
      )}
    </section>
  ));

  const periodLabel =
    scale === "day"
      ? formatFullDate(anchor)
      : scale === "week"
        ? `${formatDayShort(from)} – ${formatDayShort(to)}`
        : scale === "month"
          ? formatMonthLabel(anchor)
          : anchor.slice(0, 4);

  const isCurrentPeriod =
    scale === "day"
      ? anchor === now
      : scale === "week"
        ? startOfWeek(anchor) === startOfWeek(now)
        : scale === "month"
          ? isSameMonth(anchor, now)
          : anchor.slice(0, 4) === now.slice(0, 4);

  const href = (date: string) => `/calendar?view=${scale}&date=${date}`;
  const people = getPeople();

  return (
    <>
      <PageHeader title="Calendar" />

      <CalendarView
        scale={scale}
        anchor={anchor}
        today={now}
        days={days}
        dayPanels={dayPanels}
        periodLabel={periodLabel}
        prevHref={href(prev)}
        nextHref={href(next)}
        todayHref={href(now)}
        nowMinutes={
          days.some((d) => d.isToday)
            ? minutesIntoDay(new Date().toISOString(), tz)
            : null
        }
        isCurrentPeriod={isCurrentPeriod}
      />

      {people.length > 0 && scale !== "year" && (
        <ul className="mt-5 flex flex-wrap gap-x-4 gap-y-1 px-1 text-xs text-muted">
          {people.map((person) => (
            <li key={person.id} className="flex items-center gap-1.5">
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: person.color }}
              />
              {person.name}
            </li>
          ))}
          <li className="flex items-center gap-1.5">
            <span className="h-2 w-2 shrink-0 rounded-full bg-[#6b7280]" />
            Apartment
          </li>
        </ul>
      )}
    </>
  );
}
