import Link from "next/link";
import { requireSignedIn } from "@/lib/guard";
import { getEvents, getPeople, groupByDay, timezone } from "@/lib/data";
import { refreshIfStale } from "@/lib/sync";
import {
  addDays,
  formatDayShort,
  startOfWeek,
  today,
  weekdayOf,
} from "@/lib/dates";
import { DaySection } from "@/components/event-list";
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
  const events = getEvents(weekStart, weekEnd);
  const days = groupByDay(events, weekStart, weekEnd);
  const people = getPeople();

  const isThisWeek = weekStart === startOfWeek(now);

  return (
    <>
      <PageHeader
        title="Week"
        subtitle={`${formatDayShort(weekStart)} – ${formatDayShort(weekEnd)}`}
      />

      <nav className="mb-4 flex items-center gap-2">
        <Link
          href={`/calendar?week=${addDays(weekStart, -7)}`}
          className="rounded-lg border border-border bg-surface px-3 py-2 text-sm hover:border-muted"
        >
          ←
        </Link>
        <Link
          href="/calendar"
          aria-disabled={isThisWeek}
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
          className="rounded-lg border border-border bg-surface px-3 py-2 text-sm hover:border-muted"
        >
          →
        </Link>
      </nav>

      {/* At-a-glance strip: one column per day, a dot per event. */}
      <ul className="mb-6 grid grid-cols-7 gap-1">
        {days.map(({ day, events: dayEvents }) => {
          const isToday = day === now;
          return (
            <li
              key={day}
              className={`rounded-lg border p-1.5 text-center ${
                isToday
                  ? "border-accent bg-accent/5"
                  : "border-border bg-surface"
              }`}
            >
              <div className="text-[10px] font-medium uppercase text-muted">
                {WEEKDAY_INITIALS[weekdayOf(day)]}
              </div>
              <div
                className={`text-sm font-semibold ${isToday ? "text-accent" : ""}`}
              >
                {Number(day.slice(8, 10))}
              </div>
              <div className="mt-1 flex h-2 flex-wrap items-center justify-center gap-0.5">
                {dayEvents.slice(0, 4).map((event) => (
                  <span
                    key={event.key}
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ backgroundColor: event.color }}
                  />
                ))}
              </div>
            </li>
          );
        })}
      </ul>

      {people.length > 0 && (
        <ul className="mb-6 flex flex-wrap gap-x-4 gap-y-1 px-1 text-xs text-muted">
          {people.map((person) => (
            <li key={person.id} className="flex items-center gap-1.5">
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: person.color }}
              />
              {person.name}
            </li>
          ))}
          <li className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-[#6b7280]" />
            Apartment
          </li>
        </ul>
      )}

      {days.map(({ day, events: dayEvents }) => (
        <DaySection key={day} day={day} events={dayEvents} timeZone={tz} />
      ))}
    </>
  );
}
