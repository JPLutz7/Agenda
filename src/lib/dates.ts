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

/**
 * The timezone the dorm lives in. One place, one answer.
 *
 * Notre Dame is in St. Joseph County, which is Eastern and observes DST.
 * Indiana is not uniform about this — the northwest corner of the state runs
 * on Central — so this is the county's zone rather than a state-wide guess.
 * Changeable in Setup.
 */
export const DEFAULT_TIMEZONE = "America/Indiana/Indianapolis";

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

/**
 * '7p', '8:30a' — for places with room for a time but not for '8:30 AM',
 * like a chip inside a month cell.
 */
export function formatTimeCompact(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const minute = get("minute");
  const suffix = get("dayPeriod").toLowerCase().startsWith("a") ? "a" : "p";
  return minute === "00"
    ? `${get("hour")}${suffix}`
    : `${get("hour")}:${minute}${suffix}`;
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

/* --------------------------------------------------- months and years --- */

export function startOfMonth(day: DayKey): DayKey {
  return `${day.slice(0, 7)}-01`;
}

export function addMonths(day: DayKey, n: number): DayKey {
  const [y, m, d] = day.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + n, 1));
  // Clamp to the last valid day: 31 Jan + 1 month is 28 Feb, not 3 March.
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

export function addYears(day: DayKey, n: number): DayKey {
  return addMonths(day, n * 12);
}

export function daysInMonth(day: DayKey): number {
  const [y, m] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/**
 * The full grid a month is drawn on: whole weeks from the Sunday on or before
 * the 1st, to the Saturday on or after the last day. Always 35 or 42 cells.
 */
export function monthGridRange(day: DayKey): { from: DayKey; to: DayKey } {
  const first = startOfMonth(day);
  const last = `${day.slice(0, 7)}-${String(daysInMonth(day)).padStart(2, "0")}`;
  const from = startOfWeek(first);
  const to = addDays(startOfWeek(last), 6);
  return { from, to };
}

export function isSameMonth(a: DayKey, b: DayKey): boolean {
  return a.slice(0, 7) === b.slice(0, 7);
}

export function formatMonthLabel(day: DayKey): string {
  const [y, m] = day.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "long",
    year: "numeric",
  }).format(new Date(Date.UTC(y, m - 1, 1)));
}

export function formatMonthShort(day: DayKey): string {
  const [y, m] = day.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
  }).format(new Date(Date.UTC(y, m - 1, 1)));
}

/** 'Tuesday, 28 July 2026' — the heading for a single day. */
export function formatFullDate(day: DayKey): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

/** '7 PM – 8:30 PM', or 'All day'. */
export function formatTimeRange(
  startsAt: string,
  endsAt: string,
  allDay: boolean,
  timeZone: string,
): string {
  if (allDay) return "All day";
  return `${formatTime(startsAt, timeZone)} – ${formatTime(endsAt, timeZone)}`;
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

/**
 * '2026-07-27' + '18:30' in America/New_York → '2026-07-27T22:30:00.000Z'.
 *
 * Derives the zone's offset at that moment by formatting a provisional
 * instant back into the zone and measuring the drift, which avoids pulling in
 * a timezone library for the one place we need this direction.
 */
export function wallClockToUtc(date: string, time: string, timeZone: string): string {
  const [hour, minute] = time.split(":").map(Number);
  const naive = Date.parse(
    `${date}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00Z`,
  );

  const offsetAt = (instant: number) => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(instant));
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
    const asUtc = Date.UTC(
      get("year"),
      get("month") - 1,
      get("day"),
      get("hour"),
      get("minute"),
      get("second"),
    );
    return asUtc - instant;
  };

  // One correction pass, then a second to settle the DST boundary cases.
  let instant = naive - offsetAt(naive);
  instant = naive - offsetAt(instant);
  return new Date(instant).toISOString();
}
