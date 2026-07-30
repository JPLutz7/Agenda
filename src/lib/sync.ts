import { db } from "./db";
import { looksLikeSharedCalendar } from "./colors";
import { expandIcs, fetchIcs } from "./ics";
import {
  discoverCalendarsForAccount,
  fetchCalendarDocuments,
  type StoredAccount,
} from "./caldav";

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

/**
 * Re-read the calendar list on every connected account.
 *
 * The list is discovered when an account is first connected, but people make
 * calendars later — a shared "Dorm" one is usually created *because* they
 * started using this app. Without this, a new calendar never appears and there
 * is nothing in the interface to suggest why.
 *
 * Renames and permission changes are picked up too. Calendars that have gone
 * from the account are dropped, along with their cached events.
 */
export async function reconcileCalendars(): Promise<void> {
  const accounts = db
    .prepare<[], StoredAccount>(
      "SELECT id, server_url, username, password_enc FROM caldav_accounts",
    )
    .all();

  for (const account of accounts) {
    try {
      const found = await discoverCalendarsForAccount(account);

      // An account with no usable calendars is possible, but so is a partial
      // response from a flaky server — and acting on the second would delete
      // everything. Only reconcile when there's something to reconcile.
      if (found.length === 0) continue;

      // owner_set is decided here, on the insert, and deliberately left out of
      // the DO UPDATE: a calendar called "Dorm" starts out as the dorm's
      // rather than as whoever owns the Apple ID it sits in, and then whatever
      // is chosen in Setup stands, however many syncs run afterwards.
      const upsert = db.prepare(
        `INSERT INTO caldav_calendars
           (account_id, url, display_name, read_only, enabled, owner_set)
         VALUES (?, ?, ?, ?, 1, ?)
         ON CONFLICT(account_id, url) DO UPDATE SET
           display_name = excluded.display_name,
           read_only    = excluded.read_only`,
      );
      const placeholders = found.map(() => "?").join(",");
      const prune = db.prepare(
        `DELETE FROM caldav_calendars
         WHERE account_id = ? AND url NOT IN (${placeholders})`,
      );

      db.transaction(() => {
        for (const c of found) {
          upsert.run(
            account.id,
            c.url,
            c.displayName,
            c.readOnly ? 1 : 0,
            looksLikeSharedCalendar(c.displayName) ? 1 : 0,
          );
        }
        prune.run(account.id, ...found.map((c) => c.url));
        db.prepare(
          "UPDATE caldav_accounts SET last_error = NULL WHERE id = ?",
        ).run(account.id);
      })();
    } catch (err) {
      db.prepare(
        "UPDATE caldav_accounts SET last_error = ? WHERE id = ?",
      ).run(err instanceof Error ? err.message : String(err), account.id);
    }
  }
}

/** Every source: published feeds and connected CalDAV calendars alike. */
export async function syncAllFeeds(): Promise<SyncResult[]> {
  // Find out what calendars exist before syncing them, so one added in iCloud
  // shows up on the next refresh rather than never.
  await reconcileCalendars();

  const feeds = db
    .prepare<[], FeedRow>("SELECT * FROM feeds ORDER BY id")
    .all();
  const calendars = db
    .prepare<[], CalendarRow>(
      `SELECT id, account_id, url, display_name FROM caldav_calendars
       WHERE enabled = 1 ORDER BY id`,
    )
    .all();

  // A dorm has a handful of calendars; fetching them together is fine.
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
