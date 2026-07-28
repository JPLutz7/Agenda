import Link from "next/link";
import { requireSignedIn } from "@/lib/guard";
import { getEvents, getPeople, groupByDay, timezone } from "@/lib/data";
import { refreshIfStale } from "@/lib/sync";
import {
  addDays,
  formatDayLabel,
  formatDayShort,
  formatTime,
  minutesIntoDay,
  startOfWeek,
  today,
  weekdayOf,
} from "@/lib/dates";
import { EventRow } from "@/components/event-list";
import { WeekCalendar, type GridDay } from "@/components/week-calendar";
import { PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

const WEEKDAY_INITIALS = ["S", "M", "T", "W", "T", "F", "S"];

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  await requireSignedIn();
  refreshIfStale();

  const tz = timezone();
  const params = await searchParams;
  const now = today(tz);
  const anchor = /^\d{4}-\d{2}-\d{2}$/.test(params.week ?? "")
    ? params.week!
    : now;

  const weekStart = startOfWeek(anchor);
  const weekEnd = addDays(weekStart, 6);
  const days = groupByDay(getEvents(weekStart, weekEnd), weekStart, weekEnd);
  const people = getPeople();
  const isThisWeek = weekStart === startOfWeek(now);

  // All the timezone arithmetic happens here; the grid receives plain numbers.
  const gridDays: GridDay[] = days.map(({ day, events }) => ({
    day,
    weekdayInitial: WEEKDAY_INITIALS[weekdayOf(day)],
    dayOfMonth: String(Number(day.slice(8, 10))),
    isToday: day === now,
    events: events.map((event) => {
      const startMinutes = event.allDay
        ? 0
        : minutesIntoDay(event.startsAt, tz);
      // An event running past midnight is clamped to the end of its own day
      // rather than bleeding into the next column.
      const rawEnd = event.allDay ? 1440 : minutesIntoDay(event.endsAt, tz);
      const endMinutes =
        !event.allDay && rawEnd <= startMinutes ? 1440 : rawEnd;
      return {
        key: event.key,
        summary: event.summary,
        color: event.color,
        allDay: event.allDay,
        startMinutes,
        endMinutes,
        timeLabel: event.allDay ? "All day" : formatTime(event.startsAt, tz),
      };
    }),
  }));

  const selectedIndex = Math.max(
    0,
    days.findIndex((d) => d.day === now),
  );

  const nowMinutes = days.some((d) => d.day === now)
    ? minutesIntoDay(new Date().toISOString(), tz)
    : null;

  const dayPanels = days.map(({ day, events }) => (
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

  return (
    <>
      <PageHeader
        title="Week"
        subtitle={`${formatDayShort(weekStart)} – ${formatDayShort(weekEnd)}`}
      />

      <nav className="mb-3 flex items-center gap-2">
        <Link
          href={`/calendar?week=${addDays(weekStart, -7)}`}
          aria-label="Previous week"
          className="rounded-lg border border-border bg-surface px-3 py-2 text-sm hover:border-muted"
        >
          ←
        </Link>
        <Link
          href="/calendar"
          className={`rounded-lg border border-border px-3 py-2 text-sm ${
            isThisWeek
              ? "bg-surface-muted text-muted"
              : "bg-surface hover:border-muted"
          }`}
        >
          This week
        </Link>
        <Link
          href={`/calendar?week=${addDays(weekStart, 7)}`}
          aria-label="Next week"
          className="rounded-lg border border-border bg-surface px-3 py-2 text-sm hover:border-muted"
        >
          →
        </Link>
      </nav>

      <WeekCalendar
        days={gridDays}
        dayPanels={dayPanels}
        initialSelected={selectedIndex}
        nowMinutes={nowMinutes}
      />

      {people.length > 0 && (
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
