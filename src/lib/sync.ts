import { db } from "./db";
import { expandIcs, fetchIcs } from "./ics";
import { fetchCalendarDocuments, type StoredAccount } from "./caldav";

/**
 * How much of the calendar we keep expanded locally. Recurring events are
 * infinite; this is the slice worth materialising.
 */
const WINDOW_BEHIND_DAYS = 14;
const WINDOW_AHEAD_DAYS = 180;

/** Feeds older than this get refreshed when someone opens the app. */
export const STALE_AFTER_MS = 10 * 60 * 1000;

export type FeedRow = {
  id: number;
  person_id: number | null;
  label: string;
  url: string;
  last_synced_at: string | null;
  last_error: string | null;
};

export type SyncResult = {
  feedId: number;
  label: string;
  imported: number;
  error: string | null;
};

function window(): { start: Date; end: Date } {
  const now = Date.now();
  return {
    start: new Date(now - WINDOW_BEHIND_DAYS * 86_400_000),
    end: new Date(now + WINDOW_AHEAD_DAYS * 86_400_000),
  };
}

export async function syncFeed(feed: FeedRow): Promise<SyncResult> {
  const { start, end } = window();

  try {
    const body = await fetchIcs(feed.url);
    const occurrences = expandIcs(body, start, end);

    // Rebuild this feed's slice atomically: readers never see it half-empty,
    // and a failed fetch leaves the previous import untouched.
    const replace = db.transaction((rows: typeof occurrences) => {
      db.prepare("DELETE FROM events WHERE feed_id = ?").run(feed.id);
      const insert = db.prepare(
        `INSERT INTO events (feed_id, uid, summary, location, starts_at, ends_at, all_day)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const o of rows) {
        insert.run(
          feed.id,
          o.uid,
          o.summary,
          o.location,
          o.startsAt,
          o.endsAt,
          o.allDay ? 1 : 0,
        );
      }
      db.prepare(
        `UPDATE feeds SET last_synced_at = datetime('now'), last_error = NULL
         WHERE id = ?`,
      ).run(feed.id);
    });

    replace(occurrences);
    return {
      feedId: feed.id,
      label: feed.label,
      imported: occurrences.length,
      error: null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    db.prepare(
      `UPDATE feeds SET last_synced_at = datetime('now'), last_error = ?
       WHERE id = ?`,
    ).run(message, feed.id);
    return { feedId: feed.id, label: feed.label, imported: 0, error: message };
  }
}

export type CalendarRow = {
  id: number;
  account_id: number;
  url: string;
  display_name: string;
};

/**
 * Pull one CalDAV calendar. Same contract as syncFeed: the calendar's slice of
 * the events cache is rebuilt in a transaction, and a failure leaves the last
 * good import in place.
 */
export async function syncCalendar(
  calendar: CalendarRow,
): Promise<SyncResult> {
  const { start, end } = window();

  try {
    const account = db
      .prepare<[number], StoredAccount>(
        "SELECT id, server_url, username, password_enc FROM caldav_accounts WHERE id = ?",
      )
      .get(calendar.account_id);
    if (!account) throw new Error("That account has been disconnected.");

    const documents = await fetchCalendarDocuments(account, calendar.url);
    // Each object is its own .ics document rather than one combined calendar.
    const occurrences = documents.flatMap((doc) => {
      try {
        return expandIcs(doc, start, end);
      } catch {
        // One unparseable event shouldn't cost us the whole calendar.
        return [];
      }
    });

    const replace = db.transaction((rows: typeof occurrences) => {
      db.prepare("DELETE FROM events WHERE calendar_id = ?").run(calendar.id);
      const insert = db.prepare(
        `INSERT INTO events (calendar_id, uid, summary, location, starts_at, ends_at, all_day)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const o of rows) {
        insert.run(
          calendar.id,
          o.uid,
          o.summary,
          o.location,
          o.startsAt,
          o.endsAt,
          o.allDay ? 1 : 0,
        );
      }
      db.prepare(
        `UPDATE caldav_calendars SET last_synced_at = datetime('now'), last_error = NULL
         WHERE id = ?`,
      ).run(calendar.id);
    });

    replace(occurrences);
    return {
      feedId: calendar.id,
      label: calendar.display_name,
      imported: occurrences.length,
      error: null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    db.prepare(
      `UPDATE caldav_calendars SET last_synced_at = datetime('now'), last_error = ?
       WHERE id = ?`,
    ).run(message, calendar.id);
    return {
      feedId: calendar.id,
      label: calendar.display_name,
      imported: 0,
      error: message,
    };
  }
}

/** Every source: published feeds and connected CalDAV calendars alike. */
export async function syncAllFeeds(): Promise<SyncResult[]> {
  const feeds = db
    .prepare<[], FeedRow>("SELECT * FROM feeds ORDER BY id")
    .all();
  const calendars = db
    .prepare<[], CalendarRow>(
      `SELECT id, account_id, url, display_name FROM caldav_calendars
       WHERE enabled = 1 ORDER BY id`,
    )
    .all();

  // A household has a handful of calendars; fetching them together is fine.
  return Promise.all([
    ...feeds.map(syncFeed),
    ...calendars.map(syncCalendar),
  ]);
}

/** True when at least one source hasn't been pulled recently. */
export function feedsAreStale(): boolean {
  const row = db
    .prepare<[number, number], { stale: number }>(
      `SELECT
         (SELECT COUNT(*) FROM feeds
           WHERE last_synced_at IS NULL
              OR (julianday('now') - julianday(last_synced_at)) * 86400000 > ?)
       + (SELECT COUNT(*) FROM caldav_calendars
           WHERE enabled = 1
             AND (last_synced_at IS NULL
              OR (julianday('now') - julianday(last_synced_at)) * 86400000 > ?))
       AS stale`,
    )
    .get(STALE_AFTER_MS, STALE_AFTER_MS);
  return (row?.stale ?? 0) > 0;
}

/**
 * Refresh in the background if the data has gone stale. Deliberately not
 * awaited by page renders — a slow iCloud response shouldn't block the UI,
 * the next load picks up the results.
 */
let inFlight: Promise<unknown> | null = null;

export function refreshIfStale(): void {
  if (inFlight || !feedsAreStale()) return;
  inFlight = syncAllFeeds()
    .catch(() => undefined)
    .finally(() => {
      inFlight = null;
    });
}
