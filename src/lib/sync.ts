import { db } from "./db";
import { expandIcs, fetchIcs } from "./ics";

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

export async function syncAllFeeds(): Promise<SyncResult[]> {
  const feeds = db
    .prepare<[], FeedRow>("SELECT * FROM feeds ORDER BY id")
    .all();
  // Two roommates means a handful of feeds — fetching them together is fine.
  return Promise.all(feeds.map(syncFeed));
}

/** True when at least one feed hasn't been pulled recently. */
export function feedsAreStale(): boolean {
  const row = db
    .prepare<[number], { stale: number }>(
      `SELECT COUNT(*) AS stale FROM feeds
       WHERE last_synced_at IS NULL
          OR (julianday('now') - julianday(last_synced_at)) * 86400000 > ?`,
    )
    .get(STALE_AFTER_MS);
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
