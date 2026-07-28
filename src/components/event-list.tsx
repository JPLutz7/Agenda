import { formatDayLabel, formatTime, type DayKey } from "@/lib/dates";
import type { AgendaEvent } from "@/lib/data";
import { removeHouseholdEvent } from "@/lib/actions";
import { SubmitButton } from "@/components/forms";
import { Dot } from "@/components/ui";

export function EventRow({
  event,
  timeZone,
}: {
  event: AgendaEvent;
  timeZone: string;
}) {
  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <Dot color={event.color} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{event.summary}</p>
        <p className="mt-0.5 text-xs text-muted">
          {event.allDay ? "All day" : formatTime(event.startsAt, timeZone)}
          {event.personName ? ` · ${event.personName}` : ""}
          {event.source === "household" ? " · Apartment" : ""}
          {event.source === "chore" ? " · Chore" : ""}
          {event.location ? ` · ${event.location}` : ""}
        </p>
      </div>
      {event.source === "household" && event.householdId !== null ? (
        <form action={removeHouseholdEvent.bind(null, event.householdId)}>
          <SubmitButton variant="danger" title="Delete event" className="px-2">
            ✕
          </SubmitButton>
        </form>
      ) : null}
    </li>
  );
}

export function DaySection({
  day,
  events,
  timeZone,
}: {
  day: DayKey;
  events: AgendaEvent[];
  timeZone: string;
}) {
  return (
    <section className="mb-4">
      <h2 className="mb-1.5 px-1 text-xs font-semibold uppercase tracking-wider text-muted">
        {formatDayLabel(day, timeZone)}
      </h2>
      {events.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-4 text-sm text-muted">
          Nothing scheduled.
        </p>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
          {events.map((event) => (
            <EventRow key={event.key} event={event} timeZone={timeZone} />
          ))}
        </ul>
      )}
    </section>
  );
}
