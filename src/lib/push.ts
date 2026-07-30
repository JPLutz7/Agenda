import "server-only";
import crypto from "node:crypto";
import webpush, { type PushSubscription } from "web-push";
import { db, getSetting, setSetting } from "./db";
import { contactProblem, pushContact } from "./contact";
import { assigneeFor, getEvents, getPeople, timezone } from "./data";
import { formatTime, minutesIntoDay, today } from "./dates";

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

export type DeliveryReport = {
  /** How many phones actually took it. */
  sent: number;
  /** How many were tried. Zero means nobody has turned notifications on. */
  attempted: number;
  /**
   * How many turned out to have revoked, and were dropped from the list. Not a
   * failure to explain away — it's the normal end of a subscription, and it
   * needs its own count so it can be described as that rather than as an error.
   */
  gone: number;
  /** Why the failures failed, deduplicated — for showing, not for logs. */
  errors: string[];
};

const NOTHING: DeliveryReport = { sent: 0, attempted: 0, gone: 0, errors: [] };

async function deliver(rows: Row[], notice: Notice): Promise<DeliveryReport> {
  if (rows.length === 0) return NOTHING;

  // Checked here rather than at startup: a misconfigured contact address should
  // surface where somebody is looking at it, not in a log nobody reads.
  const contact = pushContact();
  const problem = contactProblem(contact);
  if (problem) {
    for (const row of rows) {
      db.prepare(
        `UPDATE push_subscriptions
         SET last_error = ?, failures = failures + 1 WHERE id = ?`,
      ).run(problem, row.id);
    }
    return { sent: 0, attempted: rows.length, gone: 0, errors: [problem] };
  }

  const keys = vapidKeys();
  webpush.setVapidDetails(contact, keys.publicKey, keys.privateKey);

  const payload = JSON.stringify(notice);
  let sent = 0;
  let gone = 0;
  const errors = new Set<string>();

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
          gone += 1;
          return;
        }
        const message = err instanceof Error ? err.message : String(err);
        errors.add(status ? `${status}: ${message}` : message);
        db.prepare(
          `UPDATE push_subscriptions
           SET last_error = ?, failures = failures + 1
           WHERE id = ?`,
        ).run(message.slice(0, 300), row.id);
      }
    }),
  );

  return { sent, attempted: rows.length, gone, errors: [...errors] };
}

const SELECT = "SELECT id, endpoint, p256dh, auth FROM push_subscriptions";

export async function notifyEveryone(notice: Notice): Promise<DeliveryReport> {
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
): Promise<DeliveryReport> {
  return deliver(
    db.prepare<[number], Row>(`${SELECT} WHERE person_id = ?`).all(personId),
    notice,
  );
}

/** Everyone except one person — "your roommate added something". */
export async function notifyOthers(
  personId: number | null,
  notice: Notice,
): Promise<DeliveryReport> {
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
  /** The last refusal from the push service, if the last attempt failed. */
  last_error: string | null;
  failures: number;
};

export function getDevices(): DeviceRow[] {
  return db
    .prepare<[], DeviceRow>(
      `SELECT s.id, s.label, s.created_at, s.last_sent_at, s.last_error,
              s.failures, p.name AS person_name
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
 * Something has to poke this: opening the app counts, `/api/refresh` counts,
 * and so does the server's own background loop — see `notifyDueThisMorning`,
 * which is what makes the reminder arrive without anybody doing anything.
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
    const report = who
      ? await notifyPerson(who.id, notice)
      : await notifyEveryone(notice);
    sent += report.sent;
  }
  return sent;
}

/**
 * The morning window, in dorm-local hours, that the server's own loop is
 * allowed to send the day's reminders in.
 *
 * Both ends matter. Without a floor the reminder goes out on the first tick
 * after local midnight, which is a buzz at 12:05am about a chore for a day that
 * has barely started. Without a ceiling a process that restarts late — a deploy
 * at 11pm — would fire the whole day's reminders on the way up, when the day is
 * over and nothing can be done about the bins anyway. Outside the window it
 * sends nothing *and marks nothing*, so a chore skipped tonight is still
 * waiting to be announced at 8am tomorrow.
 */
const REMINDER_FROM_HOUR = 8;
const REMINDER_UNTIL_HOUR = 21;

/**
 * The day's reminders, sent on the server's own schedule rather than because
 * somebody opened the app: chores that are due, and what's on the dorm
 * calendar.
 *
 * Called from the background loop in `instrumentation.ts`, which ticks every
 * ten minutes, so the notifications land between 8:00 and 8:10 dorm time.
 * The per-item-per-day markers inside the two functions are what keep the other
 * 77 ticks of the day silent — this function deliberately holds no state of its
 * own.
 */
export async function notifyDueThisMorning(): Promise<number> {
  const tz = timezone();
  const hour = minutesIntoDay(new Date().toISOString(), tz) / 60;
  if (hour < REMINDER_FROM_HOUR || hour >= REMINDER_UNTIL_HOUR) return 0;
  const [chores, events] = await Promise.all([
    notifyChoresDue(),
    notifyDormEventsToday(),
  ]);
  return chores + events;
}

/**
 * What's on the dorm calendar today.
 *
 * The dorm's own events, told to both phones — a landlord visit or the rent
 * going out isn't one person's business, which is what makes it a dorm event
 * rather than someone's.
 *
 * "The dorm's" means any event with nobody's name on it: the ones added in
 * this app, and anything in an iCloud calendar marked as the dorm's — the
 * shared "Dorm" calendar, typically. Both read the same way on every other
 * screen, so both belong here.
 *
 * The marker is keyed by what the event *is*, not by its row id. Feed rows are
 * a cache that gets deleted and rebuilt on every sync, so their ids change
 * underneath us — keying on one would send the same reminder again after a
 * refresh.
 */
export async function notifyDormEventsToday(): Promise<number> {
  const tz = timezone();
  const day = today(tz);

  const events = getEvents(day, day).filter(
    // Chores are handled separately and would otherwise arrive twice.
    (event) => event.personName === null && event.source !== "chore",
  );

  let sent = 0;
  for (const event of events) {
    const identity = crypto
      .createHash("sha1")
      .update(`${event.summary}|${event.startsAt}|${event.allDay}`)
      .digest("hex")
      .slice(0, 12);
    const marker = `event_notified_${identity}`;
    if (getSetting(marker) === day) continue;
    setSetting(marker, day);

    const report = await notifyEveryone({
      title: event.summary,
      body: event.allDay
        ? "On the dorm calendar today."
        : `Today at ${formatTime(event.startsAt, tz)}.`,
      url: "/",
      tag: `event-${identity}`,
    });
    sent += report.sent;
  }
  return sent;
}

let inFlight: Promise<unknown> | null = null;

/**
 * Everything today ought to have told you, safe to call from a page render.
 *
 * Not awaited — a slow push service must not hold up the page — and guarded so
 * two simultaneous loads don't both get as far as sending. The per-day markers
 * make the common case a couple of cheap queries.
 */
export function notifyTodayInBackground(): void {
  if (inFlight) return;
  inFlight = Promise.all([notifyChoresDue(), notifyDormEventsToday()])
    .catch(() => undefined)
    .finally(() => {
      inFlight = null;
    });
}
