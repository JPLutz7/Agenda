import "server-only";
import { db, getSetting } from "./db";
import { HOUSEHOLD_COLOR } from "./colors";
import {
  DEFAULT_TIMEZONE,
  addDays,
  describeDue,
  eventDayKey,
  today,
  type DayKey,
} from "./dates";

export type Person = {
  id: number;
  name: string;
  color: string;
  sort_order: number;
};

export type Feed = {
  id: number;
  person_id: number | null;
  label: string;
  url: string;
  last_synced_at: string | null;
  last_error: string | null;
  person_name: string | null;
  person_color: string | null;
  event_count: number;
};

/** A calendar entry from any source, ready to render. */
export type AgendaEvent = {
  key: string;
  summary: string;
  location: string | null;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  personName: string | null;
  color: string;
  source: "feed" | "household";
  householdId: number | null;
};

export type ChoreView = {
  id: number;
  title: string;
  cadence_days: number;
  rotates: number;
  next_due_on: DayKey;
  assignee: Person | null;
  dueLabel: string;
  overdue: boolean;
  dueToday: boolean;
  lastDoneBy: string | null;
  lastDoneAt: string | null;
};

export type ListItem = {
  id: number;
  text: string;
  checked_at: string | null;
  added_by_name: string | null;
  added_by_color: string | null;
};

export function timezone(): string {
  return getSetting("timezone") ?? DEFAULT_TIMEZONE;
}

export function getPeople(): Person[] {
  return db
    .prepare<[], Person>(
      "SELECT id, name, color, sort_order FROM people ORDER BY sort_order, id",
    )
    .all();
}

export function getFeeds(): Feed[] {
  return db
    .prepare<[], Feed>(
      `SELECT f.*, p.name AS person_name, p.color AS person_color,
              (SELECT COUNT(*) FROM events e WHERE e.feed_id = f.id) AS event_count
       FROM feeds f
       LEFT JOIN people p ON p.id = f.person_id
       ORDER BY p.sort_order, f.id`,
    )
    .all();
}

/**
 * Every event overlapping [from, to], from the iCloud feeds and from the
 * household calendar, merged and sorted. All-day events sort first within a
 * day, which is how a calendar is expected to read.
 */
export function getEvents(from: DayKey, to: DayKey): AgendaEvent[] {
  const tz = timezone();
  // Generous instant bounds — the exact day filtering happens below in the
  // household timezone, which SQL has no notion of.
  const lowerBound = `${addDays(from, -2)}T00:00:00.000Z`;
  const upperBound = `${addDays(to, 2)}T23:59:59.999Z`;

  // Events arrive from published feeds and from CalDAV calendars. Both carry
  // a person via their source, so one query covers them with a coalesce.
  //
  // The NOT EXISTS clause is the important part: an event this app created and
  // pushed to iCloud comes back down on the next sync, and without this it
  // would appear twice — once as the local copy, once as the remote echo.
  const feedRows = db
    .prepare<
      [string, string],
      {
        id: number;
        summary: string;
        location: string | null;
        starts_at: string;
        ends_at: string;
        all_day: number;
        person_name: string | null;
        person_color: string | null;
      }
    >(
      `SELECT e.id, e.summary, e.location, e.starts_at, e.ends_at, e.all_day,
              COALESCE(pf.name, pa.name)   AS person_name,
              COALESCE(pf.color, pa.color) AS person_color
       FROM events e
       LEFT JOIN feeds f            ON f.id  = e.feed_id
       LEFT JOIN people pf          ON pf.id = f.person_id
       LEFT JOIN caldav_calendars c ON c.id  = e.calendar_id
       LEFT JOIN caldav_accounts a  ON a.id  = c.account_id
       LEFT JOIN people pa          ON pa.id = a.person_id
       WHERE e.ends_at >= ? AND e.starts_at <= ?
         AND NOT EXISTS (
           SELECT 1 FROM household_events h
           WHERE h.caldav_uid IS NOT NULL AND h.caldav_uid = e.uid
         )`,
    )
    .all(lowerBound, upperBound);

  const householdRows = db
    .prepare<
      [string, string],
      {
        id: number;
        title: string;
        notes: string | null;
        starts_at: string;
        ends_at: string;
        all_day: number;
      }
    >(
      `SELECT id, title, notes, starts_at, ends_at, all_day
       FROM household_events
       WHERE ends_at >= ? AND starts_at <= ?`,
    )
    .all(lowerBound, upperBound);

  const events: AgendaEvent[] = [
    ...feedRows.map((r) => ({
      key: `f${r.id}`,
      summary: r.summary,
      location: r.location,
      startsAt: r.starts_at,
      endsAt: r.ends_at,
      allDay: r.all_day === 1,
      personName: r.person_name,
      color: r.person_color ?? HOUSEHOLD_COLOR,
      source: "feed" as const,
      householdId: null,
    })),
    ...householdRows.map((r) => ({
      key: `h${r.id}`,
      summary: r.title,
      location: r.notes,
      startsAt: r.starts_at,
      endsAt: r.ends_at,
      allDay: r.all_day === 1,
      personName: null,
      color: HOUSEHOLD_COLOR,
      source: "household" as const,
      householdId: r.id,
    })),
  ];

  return events
    .filter((e) => {
      const day = eventDayKey(e.startsAt, e.allDay, tz);
      return day >= from && day <= to;
    })
    .sort((a, b) => {
      const dayA = eventDayKey(a.startsAt, a.allDay, tz);
      const dayB = eventDayKey(b.startsAt, b.allDay, tz);
      if (dayA !== dayB) return dayA < dayB ? -1 : 1;
      if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
      if (a.startsAt !== b.startsAt) return a.startsAt < b.startsAt ? -1 : 1;
      return a.summary.localeCompare(b.summary);
    });
}

/** Events bucketed by local day, including days with nothing on them. */
export function groupByDay(
  events: AgendaEvent[],
  from: DayKey,
  to: DayKey,
): { day: DayKey; events: AgendaEvent[] }[] {
  const tz = timezone();
  const buckets = new Map<DayKey, AgendaEvent[]>();
  for (let day = from; day <= to; day = addDays(day, 1)) {
    buckets.set(day, []);
  }
  for (const event of events) {
    const day = eventDayKey(event.startsAt, event.allDay, tz);
    buckets.get(day)?.push(event);
  }
  return [...buckets.entries()].map(([day, evts]) => ({ day, events: evts }));
}

export function getChores(): ChoreView[] {
  const tz = timezone();
  const now = today(tz);
  const people = getPeople();

  const rows = db
    .prepare<
      [],
      {
        id: number;
        title: string;
        cadence_days: number;
        rotates: number;
        fixed_owner_id: number | null;
        next_due_on: string;
        rotation_index: number;
      }
    >(
      `SELECT id, title, cadence_days, rotates, fixed_owner_id,
              next_due_on, rotation_index
       FROM chores WHERE archived = 0
       ORDER BY next_due_on, id`,
    )
    .all();

  const lastDone = db.prepare<
    [number],
    { name: string | null; completed_at: string }
  >(
    `SELECT p.name AS name, c.completed_at
     FROM chore_completions c
     LEFT JOIN people p ON p.id = c.person_id
     WHERE c.chore_id = ? ORDER BY c.completed_at DESC LIMIT 1`,
  );

  return rows.map((row) => {
    const last = lastDone.get(row.id);
    return {
      id: row.id,
      title: row.title,
      cadence_days: row.cadence_days,
      rotates: row.rotates,
      next_due_on: row.next_due_on,
      assignee: assigneeFor(row, people),
      dueLabel: describeDue(row.next_due_on, tz),
      overdue: row.next_due_on < now,
      dueToday: row.next_due_on === now,
      lastDoneBy: last?.name ?? null,
      lastDoneAt: last?.completed_at ?? null,
    };
  });
}

/**
 * Whose turn it is. Rotating chores walk the roommate list in order; the
 * rotation index only advances when someone actually marks the chore done,
 * so skipping a week doesn't silently hand the turn to the other person.
 */
export function assigneeFor(
  chore: { rotates: number; fixed_owner_id: number | null; rotation_index: number },
  people: Person[],
): Person | null {
  if (!chore.rotates) {
    return people.find((p) => p.id === chore.fixed_owner_id) ?? null;
  }
  if (people.length === 0) return null;
  return people[((chore.rotation_index % people.length) + people.length) % people.length];
}

export type CalDavCalendarView = {
  id: number;
  url: string;
  display_name: string;
  read_only: number;
  enabled: number;
  last_synced_at: string | null;
  last_error: string | null;
  event_count: number;
};

export type CalDavAccountView = {
  id: number;
  label: string;
  username: string;
  person_id: number | null;
  person_name: string | null;
  person_color: string | null;
  last_error: string | null;
  calendars: CalDavCalendarView[];
};

export function getCalDavAccounts(): CalDavAccountView[] {
  const accounts = db
    .prepare<
      [],
      {
        id: number;
        label: string;
        username: string;
        person_id: number | null;
        person_name: string | null;
        person_color: string | null;
        last_error: string | null;
      }
    >(
      `SELECT a.id, a.label, a.username, a.person_id, a.last_error,
              p.name AS person_name, p.color AS person_color
       FROM caldav_accounts a
       LEFT JOIN people p ON p.id = a.person_id
       ORDER BY a.id`,
    )
    .all();

  const calendarsFor = db.prepare<[number], CalDavCalendarView>(
    `SELECT c.id, c.url, c.display_name, c.read_only, c.enabled,
            c.last_synced_at, c.last_error,
            (SELECT COUNT(*) FROM events e WHERE e.calendar_id = c.id) AS event_count
     FROM caldav_calendars c
     WHERE c.account_id = ?
     ORDER BY c.display_name`,
  );

  return accounts.map((a) => ({ ...a, calendars: calendarsFor.all(a.id) }));
}

export type WriteTarget = {
  id: number;
  account_id: number;
  url: string;
  display_name: string;
};

/** A calendar this app is allowed to write to, or null if it isn't one. */
export function getWritableCalendar(id: number): WriteTarget | null {
  if (!Number.isInteger(id)) return null;
  return (
    db
      .prepare<[number], WriteTarget>(
        `SELECT id, account_id, url, display_name FROM caldav_calendars
         WHERE id = ? AND read_only = 0`,
      )
      .get(id) ?? null
  );
}

/** The calendar that app-created events get written to, if one is chosen. */
export function getWriteCalendar(): WriteTarget | null {
  const id = getSetting("write_calendar_id");
  if (!id) return null;
  return getWritableCalendar(Number(id));
}

export type WritableCalendarOption = {
  id: number;
  display_name: string;
  account_label: string;
};

/**
 * Every calendar an event could be sent to, for the picker on the add form.
 * Read-only calendars are left out — iCloud would refuse the write. The
 * account label rides along because two accounts can each have a "Home".
 */
export function getWritableCalendars(): WritableCalendarOption[] {
  return db
    .prepare<[], WritableCalendarOption>(
      `SELECT c.id, c.display_name, a.label AS account_label
       FROM caldav_calendars c
       JOIN caldav_accounts a ON a.id = c.account_id
       WHERE c.read_only = 0
       ORDER BY a.id, c.display_name`,
    )
    .all();
}

export function getListItems(): { open: ListItem[]; done: ListItem[] } {
  const rows = db
    .prepare<[], ListItem>(
      `SELECT l.id, l.text, l.checked_at,
              p.name AS added_by_name, p.color AS added_by_color
       FROM list_items l
       LEFT JOIN people p ON p.id = l.added_by
       ORDER BY l.created_at`,
    )
    .all();
  return {
    open: rows.filter((r) => !r.checked_at),
    done: rows.filter((r) => r.checked_at),
  };
}

/** Everything the home screen needs, in one pass. */
export function getDashboard() {
  const tz = timezone();
  const from = today(tz);
  const to = addDays(from, 13);
  const events = getEvents(from, to);
  return {
    timezone: tz,
    today: from,
    days: groupByDay(events, from, to),
    chores: getChores(),
    list: getListItems(),
    people: getPeople(),
    feeds: getFeeds(),
    accounts: getCalDavAccounts(),
    writeCalendar: getWriteCalendar(),
    writableCalendars: getWritableCalendars(),
  };
}
