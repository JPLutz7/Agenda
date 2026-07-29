import Link from "next/link";
import {
  eventDayKey,
  formatDayLabel,
  formatTime,
  type DayKey,
} from "@/lib/dates";
import type { AgendaEvent } from "@/lib/data";
import { removeHouseholdEvent } from "@/lib/actions";
import { SubmitButton } from "@/components/forms";
import { Dot } from "@/components/ui";
import { Pencil, Trash2 } from "lucide-react";

export function EventRow({
  event,
  timeZone,
  /** Already happened: still listed, but out of the way. */
  past = false,
  /** The soonest thing still to come today. */
  next = false,
  /** Happening right now. */
  now = false,
}: {
  event: AgendaEvent;
  timeZone: string;
  past?: boolean;
  next?: boolean;
  now?: boolean;
}) {
  return (
    <li
      className={`flex items-start gap-3 px-4 py-3 ${
        past ? "opacity-45" : ""
      } ${next || now ? "bg-accent/5" : ""}`}
    >
      <Dot color={event.color} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">
          {event.summary}
          {(now || next) && (
            <span className="ml-2 align-middle rounded bg-accent/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">
              {now ? "now" : "next"}
            </span>
          )}
        </p>
        <p className="mt-0.5 text-xs text-muted">
          {event.allDay ? "All day" : formatTime(event.startsAt, timeZone)}
          {event.personName ? ` · ${event.personName}` : ""}
          {event.source === "household" ? " · Apartment" : ""}
          {event.source === "chore" ? " · Chore" : ""}
          {event.location ? ` · ${event.location}` : ""}
        </p>
      </div>
      {event.source === "household" && event.householdId !== null ? (
        <>
          {/* A link rather than a form: the editor is the calendar's dialog,
              and duplicating it into every row of every list would mean two
              of them to keep in step. */}
          <Link
            href={`/calendar?view=day&date=${eventDayKey(
              event.startsAt,
              event.allDay,
              timeZone,
            )}&edit=${event.householdId}`}
            title={`Edit ${event.summary}`}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted transition hover:bg-surface-muted hover:text-foreground"
          >
            <Pencil className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
          </Link>
          <form action={removeHouseholdEvent.bind(null, event.householdId)}>
            <SubmitButton variant="danger" size="icon" title="Delete event">
              <Trash2 className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
            </SubmitButton>
          </form>
        </>
      ) : null}
    </li>
  );
}

export function DaySection({
  day,
  events,
  timeZone,
  /**
   * Now, as an instant — passed only for today. With it, the list stops being a
   * flat wall of equal-weight rows and starts answering "what's next": what has
   * already happened fades back, and the soonest thing left is marked.
   */
  nowIso,
}: {
  day: DayKey;
  events: AgendaEvent[];
  timeZone: string;
  nowIso?: string;
}) {
  // An all-day event is never "past" — it's true for the whole day — and never
  // "now" or "next", since it isn't at a time you're heading towards.
  const timed = (event: AgendaEvent) => nowIso !== undefined && !event.allDay;
  const isOver = (event: AgendaEvent) =>
    timed(event) && event.endsAt <= nowIso!;
  const isUnderway = (event: AgendaEvent) =>
    timed(event) && event.startsAt <= nowIso! && event.endsAt > nowIso!;

  // Something already underway gets the badge; only when nothing is does the
  // next thing take it. Marking dinner "next" while you're eating it is worse
  // than marking nothing.
  const underwayKey = events.find(isUnderway)?.key;
  const nextKey = underwayKey
    ? undefined
    : events.find((event) => timed(event) && event.startsAt > nowIso!)?.key;

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
            <EventRow
              key={event.key}
              event={event}
              timeZone={timeZone}
              past={isOver(event)}
              now={event.key === underwayKey}
              next={event.key === nextKey}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
