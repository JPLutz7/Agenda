/**
 * Everything in the database is stored one of two ways:
 *
 *   - timed events   → ISO-8601 UTC, e.g. '2026-07-27T18:30:00.000Z'
 *   - all-day events → a bare date key, e.g. '2026-07-27'
 *
 * All-day events deliberately never become timestamps. Storing "July 4th" as
 * a UTC instant is how all-day events end up showing on July 3rd for half the
 * world, so they stay as plain dates from the .ics file all the way to the UI.
 */

export type DayKey = string; // 'YYYY-MM-DD'

/** The timezone the apartment lives in. One place, one answer. */
export const DEFAULT_TIMEZONE = "America/New_York";

const dayKeyFormatters = new Map<string, Intl.DateTimeFormat>();

function dayKeyFormatter(timeZone: string): Intl.DateTimeFormat {
  let fmt = dayKeyFormatters.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    dayKeyFormatters.set(timeZone, fmt);
  }
  return fmt;
}

/** Which local calendar day an instant falls on. 'en-CA' formats as ISO. */
export function toDayKey(date: Date, timeZone: string): DayKey {
  return dayKeyFormatter(timeZone).format(date);
}

export function today(timeZone: string): DayKey {
  return toDayKey(new Date(), timeZone);
}

export function addDays(day: DayKey, n: number): DayKey {
  const [y, m, d] = day.split("-").map(Number);
  // UTC math on a date-only value: no DST, no drift.
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

export function daysBetween(from: DayKey, to: DayKey): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

/** 0 = Sunday. Matches the week grid's column order. */
export function weekdayOf(day: DayKey): number {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** The Sunday on or before `day`. */
export function startOfWeek(day: DayKey): DayKey {
  return addDays(day, -weekdayOf(day));
}

/**
 * The day key an event belongs to, whichever storage form it uses.
 * All-day values are already day keys and must not be re-interpreted.
 */
export function eventDayKey(
  startsAt: string,
  allDay: boolean,
  timeZone: string,
): DayKey {
  return allDay ? startsAt.slice(0, 10) : toDayKey(new Date(startsAt), timeZone);
}

const timeFormatters = new Map<string, Intl.DateTimeFormat>();

/** '6:30 PM' — or '6 PM' when it's on the hour, which reads better in a list. */
export function formatTime(iso: string, timeZone: string): string {
  let fmt = timeFormatters.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "numeric",
      minute: "2-digit",
    });
    timeFormatters.set(timeZone, fmt);
  }
  return fmt.format(new Date(iso)).replace(":00", "");
}

/** Minutes from local midnight — the y-offset for an event in the week grid. */
export function minutesIntoDay(iso: string, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return hour * 60 + minute;
}

export function formatDayLabel(day: DayKey, timeZone: string): string {
  const t = today(timeZone);
  if (day === t) return "Today";
  if (day === addDays(t, 1)) return "Tomorrow";
  if (day === addDays(t, -1)) return "Yesterday";
  const [y, m, d] = day.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "long",
    month: "short",
    day: "numeric",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

export function formatDayShort(day: DayKey): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

/** 'in 3 days', 'today', '2 days late' — for chore due dates. */
export function describeDue(dueOn: DayKey, timeZone: string): string {
  const diff = daysBetween(today(timeZone), dueOn);
  if (diff === 0) return "due today";
  if (diff === 1) return "due tomorrow";
  if (diff === -1) return "1 day late";
  if (diff < 0) return `${-diff} days late`;
  return `due in ${diff} days`;
}
