import "server-only";
import webpush, { type PushSubscription } from "web-push";
import { db, getSetting, setSetting } from "./db";
import { assigneeFor, getPeople, timezone } from "./data";
import { today } from "./dates";

/**
 * Notifications on both phones.
 *
 * The app could never tell anyone anything: every fact in it required opening
 * it first, which is a poor showing for something whose job is remembering
 * that the bins are yours today.
 *
 * **About the service worker.** Web push needs one — there is no way around
 * that, it's the only thing a phone can wake up when the app is closed. The
 * rest of this project deliberately has none, because a service worker that
 * caches is the usual reason an installed web app gets stuck on a version from
 * three deploys ago. So `public/sw.js` handles push and notification clicks and
 * **has no `fetch` handler at all**. With nothing intercepting requests there
 * is nothing to serve stale, and a deploy still reaches both phones the next
 * time either of them opens the app. If anyone ever adds caching to that file,
 * they've traded away the thing that makes this app trustworthy.
 */

const CONTACT = "mailto:agenda@localhost";

type Keys = { publicKey: string; privateKey: string };

/**
 * The pair that identifies this server to Apple's and Google's push services.
 *
 * Generated once and kept in `settings`. Not encrypted, and deliberately not:
 * the private key is only useful alongside the subscription endpoints, which
 * live in the same database — encrypting one of the two would be theatre.
 * Losing them costs a re-subscribe on each phone, nothing more.
 */
function vapidKeys(): Keys {
  const existing = getSetting("vapid_public_key");
  const secret = getSetting("vapid_private_key");
  if (existing && secret) return { publicKey: existing, privateKey: secret };

  const generated = webpush.generateVAPIDKeys();
  setSetting("vapid_public_key", generated.publicKey);
  setSetting("vapid_private_key", generated.privateKey);
  return generated;
}

/** The half the browser needs in order to subscribe. */
export function publicKey(): string {
  return vapidKeys().publicKey;
}

type Row = {
  id: number;
  endpoint: string;
  p256dh: string;
  auth: string;
};

function toSubscription(row: Row): PushSubscription {
  return {
    endpoint: row.endpoint,
    keys: { p256dh: row.p256dh, auth: row.auth },
  };
}

export type Notice = {
  title: string;
  body: string;
  /** Where tapping it should land. */
  url?: string;
  /**
   * Replaces an unread notification with the same tag rather than stacking.
   * Two "bins are due" on one lock screen is worse than one.
   */
  tag?: string;
};

async function deliver(rows: Row[], notice: Notice): Promise<number> {
  if (rows.length === 0) return 0;
  const keys = vapidKeys();
  webpush.setVapidDetails(CONTACT, keys.publicKey, keys.privateKey);

  const payload = JSON.stringify(notice);
  let sent = 0;

  await Promise.all(
    rows.map(async (row) => {
      try {
        await webpush.sendNotification(toSubscription(row), payload, {
          TTL: 12 * 60 * 60,
        });
        sent += 1;
        db.prepare(
          `UPDATE push_subscriptions
           SET last_sent_at = datetime('now'), last_error = NULL, failures = 0
           WHERE id = ?`,
        ).run(row.id);
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        // 404/410 mean the phone has revoked it — uninstalled the app, cleared
        // Safari, changed their mind. Keeping the row would mean retrying a
        // dead endpoint forever.
        if (status === 404 || status === 410) {
          db.prepare("DELETE FROM push_subscriptions WHERE id = ?").run(row.id);
          return;
        }
        const message = err instanceof Error ? err.message : String(err);
        db.prepare(
          `UPDATE push_subscriptions
           SET last_error = ?, failures = failures + 1
           WHERE id = ?`,
        ).run(message.slice(0, 300), row.id);
      }
    }),
  );

  return sent;
}

const SELECT = "SELECT id, endpoint, p256dh, auth FROM push_subscriptions";

export async function notifyEveryone(notice: Notice): Promise<number> {
  return deliver(db.prepare<[], Row>(SELECT).all(), notice);
}

/**
 * Just this person's phones.
 *
 * A person with no device registered gets nothing — deliberately not falling
 * back to "tell everyone", which would mean your roommate's phone buzzing
 * about a chore that isn't theirs.
 */
export async function notifyPerson(
  personId: number,
  notice: Notice,
): Promise<number> {
  return deliver(
    db.prepare<[number], Row>(`${SELECT} WHERE person_id = ?`).all(personId),
    notice,
  );
}

/** Everyone except one person — "your roommate added something". */
export async function notifyOthers(
  personId: number | null,
  notice: Notice,
): Promise<number> {
  if (personId === null) return notifyEveryone(notice);
  return deliver(
    db
      .prepare<[number], Row>(
        `${SELECT} WHERE person_id IS NULL OR person_id <> ?`,
      )
      .all(personId),
    notice,
  );
}

export function subscriptionCount(): number {
  return (
    db
      .prepare<[], { n: number }>(
        "SELECT COUNT(*) AS n FROM push_subscriptions",
      )
      .get()?.n ?? 0
  );
}

export type DeviceRow = {
  id: number;
  label: string | null;
  person_name: string | null;
  created_at: string;
  last_sent_at: string | null;
};

export function getDevices(): DeviceRow[] {
  return db
    .prepare<[], DeviceRow>(
      `SELECT s.id, s.label, s.created_at, s.last_sent_at, p.name AS person_name
       FROM push_subscriptions s
       LEFT JOIN people p ON p.id = s.person_id
       ORDER BY s.id`,
    )
    .all();
}

/**
 * Tell whoever's turn it is that a chore is due today.
 *
 * Once per chore per day, tracked by a marker in `settings` — this runs from
 * whatever happens to touch the app, so without the marker every page load
 * would fire another buzz.
 *
 * The honest limitation: with nothing scheduled server-side, this only fires
 * when *something* pokes the app. Opening it counts, and so does the
 * `/api/refresh` endpoint, which is what an external cron is for. A phone that
 * nobody opens all day gets told nothing.
 */
export async function notifyChoresDue(): Promise<number> {
  const tz = timezone();
  const now = today(tz);
  const people = getPeople();

  const due = db
    .prepare<
      [string],
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
       FROM chores
       WHERE archived = 0 AND next_due_on <= ?`,
    )
    .all(now);

  let sent = 0;
  for (const chore of due) {
    const marker = `chore_notified_${chore.id}`;
    if (getSetting(marker) === now) continue;
    setSetting(marker, now);

    const who = assigneeFor(chore, people);
    const overdue = chore.next_due_on < now;
    const notice: Notice = {
      title: overdue ? `${chore.title} is overdue` : `${chore.title} today`,
      body: who ? `It's ${who.name}'s turn.` : "Nobody's assigned to this one.",
      url: "/chores",
      tag: `chore-${chore.id}`,
    };
    sent += who
      ? await notifyPerson(who.id, notice)
      : await notifyEveryone(notice);
  }
  return sent;
}

let inFlight: Promise<unknown> | null = null;

/**
 * The same thing, safe to call from a page render.
 *
 * Not awaited — a slow push service must not hold up the page — and guarded so
 * two simultaneous loads don't both get as far as sending. The per-day marker
 * makes the common case a single cheap query.
 */
export function notifyChoresDueInBackground(): void {
  if (inFlight) return;
  inFlight = notifyChoresDue()
    .catch(() => undefined)
    .finally(() => {
      inFlight = null;
    });
}
