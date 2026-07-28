import "server-only";
import { db, getSetting } from "./db";
import { HOUSEHOLD_COLOR } from "./colors";
import {
  DEFAULT_TIMEZONE,
  addDays,
  daysBetween,
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
  source: "feed" | "household" | "chore";
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

export type ListCategory = "need" | "want";

export type ListItem = {
  id: number;
  text: string;
  category: ListCategory;
  checked_at: string | null;
  added_by_name: string | null;
  added_by_color: string | null;
  /** Needs: what it cost the last time it was ticked off. */
  last_price_cents: number | null;
  last_price_at: string | null;
  /** Wants: the bound product and its current price. */
  retailer: string | null;
  retailer_sku: string | null;
  retailer_url: string | null;
  retailer_name: string | null;
  price_cents: number | null;
  regular_price_cents: number | null;
  price_checked_at: string | null;
  price_error: string | null;
  /** The price before the current one, so a change can be shown. */
  previous_price_cents: number | null;
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
 * Chores, as all-day entries on the calendar.
 *
 * These are generated from the rotation rather than stored as events, and
 * deliberately so: a chore's due date moves every time someone marks it done,
 * so any copy written ahead of time would be wrong within a week. Deriving
 * them on read means the calendar can never disagree with the Chores tab.
 *
 * Future turns are projected forward by the cadence, and the assignee is
 * projected with them — so you can see whose turn the bins are in a
 * fortnight, not just this week.
 */
export function getChoreEvents(from: DayKey, to: DayKey): AgendaEvent[] {
  const people = getPeople();
  const chores = db
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
       FROM chores WHERE archived = 0`,
    )
    .all();

  const out: AgendaEvent[] = [];

  for (const chore of chores) {
    const cadence = Math.max(1, chore.cadence_days);
    let day = chore.next_due_on;
    let turn = 0;

    // Jump straight to the window rather than stepping a day at a time from
    // whenever the chore was created.
    if (day < from) {
      const skipped = Math.floor(daysBetween(day, from) / cadence);
      day = addDays(day, skipped * cadence);
      turn = skipped;
    }

    // The bound is belt and braces: a one-day cadence over a month grid is
    // only ~42 turns, but nothing here should be able to loop away.
    for (let guard = 0; day <= to && guard < 400; guard++) {
      if (day >= from) {
        const assignee = assigneeFor(
          { ...chore, rotation_index: chore.rotation_index + turn },
          people,
        );
        out.push({
          key: `c${chore.id}-${day}`,
          summary: chore.title,
          location: null,
          startsAt: day,
          endsAt: addDays(day, 1),
          allDay: true,
          personName: assignee?.name ?? null,
          // Apartment colour: a chore belongs to the flat, whoever's turn it
          // happens to be.
          color: HOUSEHOLD_COLOR,
          source: "chore" as const,
          householdId: null,
        });
      }
      day = addDays(day, cadence);
      turn += 1;
    }
  }

  return out;
}

/**
 * Every event overlapping [from, to] — the iCloud feeds, the household
 * calendar, and optionally the chore rotation — merged and sorted. All-day
 * events sort first within a day, which is how a calendar is expected to read.
 */
export function getEvents(
  from: DayKey,
  to: DayKey,
  { includeChores = false }: { includeChores?: boolean } = {},
): AgendaEvent[] {
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
    // Off by default: the Today screen lists what's due in its own section,
    // and having each chore appear twice on one screen helps nobody.
    ...(includeChores ? getChoreEvents(from, to) : []),
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
      `SELECT l.id, l.text, l.category, l.checked_at,
              l.last_price_cents, l.last_price_at,
              l.retailer, l.retailer_sku, l.retailer_url, l.retailer_name,
              l.price_cents, l.regular_price_cents, l.price_checked_at,
              l.price_error,
              p.name AS added_by_name, p.color AS added_by_color,
              (SELECT h.price_cents FROM price_history h
                WHERE h.item_id = l.id
                ORDER BY h.recorded_at DESC LIMIT 1 OFFSET 1)
                AS previous_price_cents
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

/**
 * What the open Needs are likely to cost, from what was last paid.
 *
 * Only items with a remembered price count towards the estimate; `unpriced`
 * says how many are missing, so a total of $12 next to a list of thirty
 * things can't be mistaken for the real figure.
 */
export function getNeedsEstimate(): { totalCents: number; unpriced: number } {
  const row = db
    .prepare<[], { total: number | null; unpriced: number }>(
      `SELECT SUM(last_price_cents) AS total,
              SUM(CASE WHEN last_price_cents IS NULL THEN 1 ELSE 0 END) AS unpriced
       FROM list_items
       WHERE category = 'need' AND checked_at IS NULL`,
    )
    .get()!;
  return { totalCents: row.total ?? 0, unpriced: row.unpriced ?? 0 };
}

/** What's actually been spent on Needs so far this month. */
export function getSpentThisMonth(): number {
  const row = db
    .prepare<[], { total: number | null }>(
      `SELECT SUM(h.price_cents) AS total
       FROM price_history h
       JOIN list_items l ON l.id = h.item_id
       WHERE h.source = 'manual'
         AND strftime('%Y-%m', h.recorded_at) = strftime('%Y-%m', 'now')`,
    )
    .get()!;
  return row.total ?? 0;
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
