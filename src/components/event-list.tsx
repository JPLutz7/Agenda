import Link from "next/link";
import {
  eventDayKey,
  formatDayLabel,
  formatTime,
  type DayKey,
} from "@/lib/dates";
import type { AgendaEvent } from "@/lib/data";
import { countdownTo, type Countdown } from "@/lib/headline";
import { removeDormEvent } from "@/lib/actions";
import { SubmitButton } from "@/components/forms";
import { Pencil, Trash2 } from "lucide-react";
import { listClass } from "@/components/ui";

export function EventRow({
  event,
  timeZone,
  /** Already happened: still listed, but out of the way. */
  past = false,
  /** The soonest thing still to come today. */
  next = false,
  /** Happening right now. */
  now = false,
  /** How long until it starts, when that's the more useful thing to show. */
  countdown = null,
}: {
  event: AgendaEvent;
  timeZone: string;
  past?: boolean;
  next?: boolean;
  now?: boolean;
  countdown?: Countdown | null;
}) {
  // Nobody's name on it means it's the dorm's, whichever calendar it came from.
  // This used to be said only for events added in the app, so one from a shared
  // iCloud calendar was labelled with nothing at all — even though it's treated
  // as the dorm's everywhere else, notifications included.
  const whose = [
    event.personName,
    event.personName === null && event.source !== "chore" ? "Dorm" : null,
    event.source === "chore" ? "Chore" : null,
    event.location,
  ].filter(Boolean);

  return (
    <li
      className={`flex items-stretch gap-3 px-4 py-3 ${
        past ? "opacity-45" : ""
      } ${next || now ? "bg-accent/5" : ""}`}
    >
      {/* The left rail. When a thing is close enough to count down to, the
          count *is* the rail — a figure big enough to read without looking,
          with its unit as a caption. A clock time makes you subtract it from
          the clock in your status bar; "23 minutes" has already done that.
          Everything else — finished, all-day, another day — keeps the time,
          which is the more useful fact once a countdown stops being one. */}
      <div className="w-16 shrink-0 pt-px text-right">
        {countdown ? (
          <>
            <span
              className={`block font-display text-[1.375rem] font-semibold leading-none tracking-tight tabular-nums ${
                now ? "text-accent" : "text-foreground"
              }`}
            >
              {countdown.value}
            </span>
            {countdown.unit && (
              <span className="mt-0.5 block text-[10px] font-medium uppercase tracking-wide text-muted">
                {countdown.unit}
              </span>
            )}
          </>
        ) : (
          <span
            className={`text-xs font-medium tabular-nums ${
              now || next ? "text-accent" : "text-muted"
            }`}
          >
            {event.allDay ? "All day" : formatTime(event.startsAt, timeZone)}
          </span>
        )}
      </div>
      <span
        aria-hidden="true"
        className="w-[3px] shrink-0 rounded-full"
        style={{ backgroundColor: event.color }}
      />
      <div className="min-w-0 flex-1">
        {/* Wraps rather than truncating. An entry whose whole point is its name
            is not improved by hiding half of it. The "now"/"next" badges that
            used to sit here are gone: the headline at the top of Today says
            which is which, in bigger type, without repeating the title. */}
        <p className="text-sm font-medium leading-snug">{event.summary}</p>
        {whose.length > 0 && (
          <p className="mt-0.5 text-xs text-muted">{whose.join(" · ")}</p>
        )}
      </div>
      {event.source === "dorm" && event.dormId !== null ? (
        // Quieter than they were, and closer together: two 36px slabs on the
        // right of every row competed with the words for attention and cost the
        // title a third of its width. They only need to be findable, not seen.
        <div className="-mr-1 flex shrink-0 items-start self-start">
          {/* A link rather than a form: the editor is the calendar's dialog,
              and duplicating it into every row of every list would mean two
              of them to keep in step. */}
          <Link
            href={`/calendar?view=day&date=${eventDayKey(
              event.startsAt,
              event.allDay,
              timeZone,
            )}&edit=${event.dormId}`}
            title={`Edit ${event.summary}`}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted/60 transition hover:bg-surface-muted hover:text-foreground"
          >
            <Pencil className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
          </Link>
          <form action={removeDormEvent.bind(null, event.dormId)}>
            <SubmitButton
              variant="danger"
              size="icon"
              title="Delete event"
              className="h-7 w-7 rounded-md text-muted/60"
            >
              <Trash2 className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
            </SubmitButton>
          </form>
        </div>
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

  // An empty day is one word of information, so it gets one line rather than a
  // dashed box the size of a real entry. It used to take up as much room as
  // something you actually had to do.
  if (events.length === 0) {
    return (
      <section className="mb-4 flex items-baseline gap-3 px-1">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">
          {formatDayLabel(day, timeZone)}
        </h2>
        <p className="text-xs text-muted/70">Nothing scheduled</p>
      </section>
    );
  }

  return (
    <section className="mb-4">
      <h2 className="mb-1.5 px-1 text-xs font-semibold uppercase tracking-wider text-muted">
        {formatDayLabel(day, timeZone)}
      </h2>
      <ul className={listClass}>
        {events.map((event) => (
          <EventRow
            key={event.key}
            event={event}
            timeZone={timeZone}
            past={isOver(event)}
            now={event.key === underwayKey}
            next={event.key === nextKey}
            // Only today's timed entries: counting down to something on
            // Saturday would say "hours" for two days running.
            countdown={
              timed(event)
                ? countdownTo(event.startsAt, event.endsAt, nowIso!)
                : null
            }
          />
        ))}
      </ul>
    </section>
  );
}
