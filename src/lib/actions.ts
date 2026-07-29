"use server";

import crypto from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db, setSetting } from "./db";
import {
  devicePerson,
  endSession,
  isPasscodeSet,
  isSignedIn,
  setDevicePerson,
  setPasscode,
  startSession,
  verifyPasscode,
} from "./auth";
import {
  assigneeFor,
  getPeople,
  getWritableCalendar,
  getWriteCalendar,
  timezone,
} from "./data";
import { PERSON_PALETTE } from "./colors";
import {
  addDays,
  eventDayKey,
  formatDayLabel,
  formatTime,
  today,
  wallClockToUtc,
} from "./dates";
import { normalizeFeedUrl } from "./ics";
import {
  syncAllFeeds,
  syncCalendar,
  type CalendarRow,
  type FeedRow,
  syncFeed,
} from "./sync";
import {
  ICLOUD_CALDAV_URL,
  createRemoteEvent,
  deleteRemoteEvent,
  discoverCalendars,
  updateRemoteEvent,
  type StoredAccount,
} from "./caldav";
import { canStoreSecrets, encryptSecret } from "./secrets";
import {
  refreshOneWant,
  refreshPricesIfStale,
  refreshWantPrices,
} from "./prices";
import { looksLikeUrl, shopName } from "./scrape";
import { notifyEveryone, notifyOthers } from "./push";

export type ActionState = { error?: string; ok?: string };

async function requireSession() {
  if (!(await isSignedIn())) redirect("/login");
}

function text(form: FormData, field: string, max = 200): string {
  return String(form.get(field) ?? "")
    .trim()
    .slice(0, max);
}

function refreshViews() {
  for (const path of ["/", "/calendar", "/chores", "/list", "/settings"]) {
    revalidatePath(path);
  }
}

/**
 * Pull everything now, for the refresh button in the page header.
 *
 * Deliberately not `refreshIfStale`: that one returns immediately if the last
 * pull was under ten minutes ago, which is right for a page load and wrong for
 * a button. Someone tapping refresh is asking a question the ten-minute rule
 * can't answer — they've just added something on their phone's Calendar and
 * want to see it here.
 *
 * Awaited, unlike the background refresh, so the icon stops spinning when the
 * data has actually arrived rather than when the request was sent.
 */
export async function syncNow(): Promise<void> {
  await requireSession();
  try {
    await syncAllFeeds();
  } catch {
    // Nothing to undo — a feed is rebuilt inside a transaction, so a failed
    // pull leaves the last good copy in place. The page still revalidates:
    // household events and chores are local and are current regardless, and
    // Setup lists each source's own error.
  }
  refreshPricesIfStale();
  refreshViews();
}

/* ------------------------------------------------------------------ setup */

export async function setupHousehold(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  if (isPasscodeSet()) return { error: "This household is already set up." };

  const passcode = text(form, "passcode", 100);
  const nameA = text(form, "name_a", 60);
  const nameB = text(form, "name_b", 60);

  if (passcode.length < 4) {
    return { error: "Pick a passcode of at least 4 characters." };
  }
  if (!nameA || !nameB) return { error: "Both names are required." };

  const insert = db.prepare(
    "INSERT INTO people (name, color, sort_order) VALUES (?, ?, ?)",
  );
  db.transaction(() => {
    insert.run(nameA, PERSON_PALETTE[0], 0);
    insert.run(nameB, PERSON_PALETTE[1], 1);
    setPasscode(passcode);
  })();

  await startSession();
  redirect("/settings?welcome=1");
}

export async function signIn(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const passcode = text(form, "passcode", 100);
  if (!verifyPasscode(passcode)) return { error: "That passcode didn't match." };
  await startSession();
  redirect("/");
}

export async function signOut(): Promise<void> {
  await endSession();
  redirect("/login");
}

/* ------------------------------------------------------------------ people */

export async function addPerson(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  await requireSession();
  const name = text(form, "name", 60);
  if (!name) return { error: "Give them a name." };

  const count = db
    .prepare<[], { n: number }>("SELECT COUNT(*) AS n FROM people")
    .get()!.n;
  db.prepare(
    "INSERT INTO people (name, color, sort_order) VALUES (?, ?, ?)",
  ).run(name, PERSON_PALETTE[count % PERSON_PALETTE.length], count);

  refreshViews();
  return { ok: `Added ${name}.` };
}

export async function updatePersonColor(
  personId: number,
  form: FormData,
): Promise<void> {
  await requireSession();
  const color = text(form, "color", 7);
  if (!/^#[0-9a-f]{6}$/i.test(color)) return;
  db.prepare("UPDATE people SET color = ? WHERE id = ?").run(color, personId);
  refreshViews();
}

export async function removePerson(personId: number): Promise<void> {
  await requireSession();
  db.prepare("DELETE FROM people WHERE id = ?").run(personId);
  refreshViews();
}

/* ------------------------------------------------------------------- feeds */

export async function addFeed(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  await requireSession();

  const label = text(form, "label", 80) || "Calendar";
  const rawUrl = text(form, "url", 2000);
  const personRaw = text(form, "person_id", 20);
  const personId = personRaw === "" || personRaw === "household"
    ? null
    : Number(personRaw);

  if (!rawUrl) return { error: "Paste the published calendar link." };

  const url = normalizeFeedUrl(rawUrl);
  if (!/^https?:\/\//i.test(url)) {
    return { error: "That doesn't look like a calendar link." };
  }

  const info = db
    .prepare(
      "INSERT INTO feeds (person_id, label, url) VALUES (?, ?, ?)",
    )
    .run(personId, label, url);

  // Pull it straight away so the user finds out now if the link is wrong,
  // rather than staring at an empty calendar wondering.
  const feed = db
    .prepare<[number], FeedRow>("SELECT * FROM feeds WHERE id = ?")
    .get(Number(info.lastInsertRowid))!;
  const result = await syncFeed(feed);

  refreshViews();
  if (result.error) return { error: result.error };
  return { ok: `Imported ${result.imported} events from ${label}.` };
}

export async function removeFeed(feedId: number): Promise<void> {
  await requireSession();
  db.prepare("DELETE FROM feeds WHERE id = ?").run(feedId);
  refreshViews();
}

export async function refreshFeeds(): Promise<void> {
  await requireSession();
  await syncAllFeeds();
  refreshViews();
}

export async function setTimezone(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  await requireSession();
  const tz = text(form, "timezone", 80);
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
  } catch {
    return { error: `"${tz}" isn't a timezone name.` };
  }
  setSetting("timezone", tz);
  refreshViews();
  return { ok: `Timezone set to ${tz}.` };
}

/* ----------------------------------------------------------- notifications */

/**
 * Register a phone for notifications.
 *
 * The browser hands over an endpoint and two keys; all three go in as one row.
 * `person_id` is asked for on the same screen because there is one shared
 * passcode — without being told, the app cannot know whether the phone in its
 * hand is João's or Nino's, and a chore reminder sent to the wrong one is worse
 * than none.
 */
export async function savePushSubscription(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  await requireSession();

  const endpoint = text(form, "endpoint", 800);
  const p256dh = text(form, "p256dh", 300);
  const auth = text(form, "auth", 200);
  const label = text(form, "label", 60) || null;
  const personRaw = text(form, "person_id", 20);
  const personId = personRaw === "" || personRaw === "household"
    ? null
    : Number(personRaw) || null;

  if (!endpoint || !p256dh || !auth) {
    return { error: "Your browser didn't hand over a usable subscription." };
  }

  // Re-subscribing the same phone yields the same endpoint, so this updates in
  // place rather than accumulating a row per visit to Setup.
  db.prepare(
    `INSERT INTO push_subscriptions (person_id, endpoint, p256dh, auth, label)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET
       person_id = excluded.person_id,
       p256dh    = excluded.p256dh,
       auth      = excluded.auth,
       label     = excluded.label,
       last_error = NULL,
       failures   = 0`,
  ).run(personId, endpoint, p256dh, auth, label);

  // Remember whose phone this is, so the app can tell "your roommate added
  // something" from "you added something" — the session alone can't.
  await setDevicePerson(personId);

  refreshViews();
  return { ok: "This phone will get notifications." };
}

export async function removePushDevice(deviceId: number): Promise<void> {
  await requireSession();
  db.prepare("DELETE FROM push_subscriptions WHERE id = ?").run(deviceId);
  refreshViews();
}

/**
 * Prove it works, from the phone you're holding.
 *
 * Takes no arguments on purpose — there's nothing to read from the form, and a
 * function with fewer parameters still satisfies what ActionForm passes.
 */
export async function sendTestNotification(): Promise<ActionState> {
  await requireSession();
  const sent = await notifyEveryone({
    title: "Agenda works",
    body: "That's all this was for. Notifications are on.",
    url: "/",
    tag: "test",
  });
  if (sent === 0) {
    return {
      error:
        "Nothing went out — no phone is registered yet, or the ones that " +
        "were have since turned notifications off.",
    };
  }
  return { ok: `Sent to ${sent} device${sent === 1 ? "" : "s"}.` };
}

/* ------------------------------------------------------------ icloud (dav) */

export async function connectICloudAccount(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  await requireSession();

  if (!canStoreSecrets()) {
    return {
      error:
        "AGENDA_SECRET isn't set on the server, so an Apple password can't " +
        "be encrypted. Set it first — the deploy guide has the command.",
    };
  }

  const username = text(form, "username", 200);
  // Apple prints app-specific passwords with spaces; they aren't part of it.
  const password = text(form, "password", 200).replace(/\s+/g, "");
  const personRaw = text(form, "person_id", 20);
  const personId = personRaw === "" || personRaw === "household"
    ? null
    : Number(personRaw);
  const label = text(form, "label", 80) || username;

  if (!username || !password) {
    return { error: "Both the Apple ID and an app-specific password." };
  }

  // Verify before storing — no point keeping credentials that don't work.
  let discovered;
  try {
    discovered = await discoverCalendars(
      ICLOUD_CALDAV_URL,
      username,
      password,
    );
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }

  if (discovered.length === 0) {
    return { error: "That account has no calendars that can hold events." };
  }

  const accountId = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO caldav_accounts (person_id, label, server_url, username, password_enc)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        personId,
        label,
        ICLOUD_CALDAV_URL,
        username,
        encryptSecret(password),
      );
    const id = Number(info.lastInsertRowid);
    const insert = db.prepare(
      `INSERT INTO caldav_calendars (account_id, url, display_name, read_only, enabled)
       VALUES (?, ?, ?, ?, 1)`,
    );
    for (const c of discovered) {
      insert.run(id, c.url, c.displayName, c.readOnly ? 1 : 0);
    }
    return id;
  })();

  // Pull them straight away so the calendar isn't empty on the way back.
  const calendars = db
    .prepare<[number], CalendarRow>(
      `SELECT id, account_id, url, display_name FROM caldav_calendars
       WHERE account_id = ? AND enabled = 1`,
    )
    .all(accountId);
  const results = await Promise.all(calendars.map(syncCalendar));
  const imported = results.reduce((sum, r) => sum + r.imported, 0);

  refreshViews();
  return {
    ok: `Connected ${label}: ${discovered.length} calendars, ${imported} events.`,
  };
}

export async function setCalendarEnabled(
  calendarId: number,
  form: FormData,
): Promise<void> {
  await requireSession();
  const enabled = text(form, "enabled", 5) === "1" ? 1 : 0;
  db.prepare("UPDATE caldav_calendars SET enabled = ? WHERE id = ?").run(
    enabled,
    calendarId,
  );
  if (enabled) {
    const calendar = db
      .prepare<[number], CalendarRow>(
        "SELECT id, account_id, url, display_name FROM caldav_calendars WHERE id = ?",
      )
      .get(calendarId);
    if (calendar) await syncCalendar(calendar);
  } else {
    db.prepare("DELETE FROM events WHERE calendar_id = ?").run(calendarId);
  }
  refreshViews();
}

/** Choose where events created in this app get written in iCloud. */
export async function setWriteCalendar(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  await requireSession();
  const raw = text(form, "calendar_id", 20);

  if (raw === "" || raw === "none") {
    setSetting("write_calendar_id", "");
    refreshViews();
    return { ok: "App events will stay in this app only." };
  }

  const calendar = db
    .prepare<[number], { display_name: string; read_only: number }>(
      "SELECT display_name, read_only FROM caldav_calendars WHERE id = ?",
    )
    .get(Number(raw));
  if (!calendar) return { error: "That calendar no longer exists." };
  if (calendar.read_only) {
    return { error: `"${calendar.display_name}" is read-only in iCloud.` };
  }

  setSetting("write_calendar_id", raw);
  refreshViews();
  return { ok: `New events will be added to "${calendar.display_name}".` };
}

/**
 * Whose account this is — which is what colours everything it brings in.
 *
 * It's chosen when the account is connected, but that's a one-off decision
 * made in a hurry, and getting it wrong meant a person's whole calendar
 * showed in the apartment's colour with no way back short of reconnecting.
 */
export async function setAccountPerson(
  accountId: number,
  form: FormData,
): Promise<void> {
  await requireSession();
  const raw = text(form, "person_id", 20);
  const personId = raw === "" || raw === "household" ? null : Number(raw);
  if (personId !== null && !Number.isInteger(personId)) return;
  db.prepare("UPDATE caldav_accounts SET person_id = ? WHERE id = ?").run(
    personId,
    accountId,
  );
  refreshViews();
}

export async function disconnectICloudAccount(
  accountId: number,
): Promise<void> {
  await requireSession();
  // Anything already written to iCloud stays there; this only forgets the
  // credentials and the local mirror.
  db.prepare("DELETE FROM caldav_accounts WHERE id = ?").run(accountId);
  refreshViews();
}

/**
 * Drop a cached copy of an event we've just removed from iCloud.
 *
 * The `events` table is a mirror of what the last sync saw, and a sync only
 * rebuilds a calendar when that calendar is pulled. So between deleting an
 * event remotely and the next pull, the stale row is still there — and since
 * the household row that used to claim it is gone (or has moved to a new UID),
 * nothing suppresses it any more and it comes back on screen as if it were
 * someone's own calendar event. Deleting an event and watching it reappear is
 * about the worst thing a calendar can do, so the mirror is corrected here
 * rather than left for the next sync.
 */
function forgetCachedEvent(uid: string | null): void {
  if (!uid) return;
  db.prepare("DELETE FROM events WHERE uid = ?").run(uid);
}

function writeAccountFor(calendarAccountId: number): StoredAccount | undefined {
  return db
    .prepare<[number], StoredAccount>(
      "SELECT id, server_url, username, password_enc FROM caldav_accounts WHERE id = ?",
    )
    .get(calendarAccountId);
}

/* -------------------------------------------------------- household events */

type EventDraft = {
  title: string;
  notes: string | null;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
};

/**
 * The event form, read once for both adding and editing.
 *
 * Shared deliberately rather than copied: the two forms are the same fields,
 * and the validation here — an all-day toggle that overrides blank times, an
 * end before its start — is exactly the part that would drift apart.
 */
function readEventForm(form: FormData): { draft?: EventDraft; error?: string } {
  const title = text(form, "title", 200);
  const date = text(form, "date", 10);
  const startTime = text(form, "start_time", 5);
  const endTime = text(form, "end_time", 5);
  const notes = text(form, "notes", 500) || null;
  // The form has an explicit All day toggle. Falling back to "no start time
  // was given" keeps older submissions working.
  const allDay = form.has("all_day")
    ? text(form, "all_day", 1) === "1"
    : !startTime;

  if (!title) return { error: "The event needs a title." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "Pick a date." };
  // A timed event with no time used to mean all-day; since the All day toggle
  // arrived it means the time was simply never filled in, and converting a
  // blank one throws deep inside the date maths.
  if (!allDay && !startTime) {
    return { error: "Give it a start time, or turn on All day." };
  }

  if (allDay) {
    return {
      draft: {
        title,
        notes,
        startsAt: date,
        endsAt: addDays(date, 1), // all-day DTEND is exclusive
        allDay: true,
      },
    };
  }

  // The form collects wall-clock time in the household timezone; convert to
  // the UTC instant the rest of the app stores.
  const startsAt = wallClockToUtc(date, startTime, timezone());
  const endsAt = endTime
    ? wallClockToUtc(date, endTime, timezone())
    : new Date(Date.parse(startsAt) + 3_600_000).toISOString();
  if (Date.parse(endsAt) < Date.parse(startsAt)) {
    return { error: "The end time is before the start time." };
  }
  return { draft: { title, notes, startsAt, endsAt, allDay: false } };
}

/**
 * Where an event goes. The form sends a choice per event, pre-selected with
 * the Setup default; a submission without the field (an older cached page)
 * falls back to that default on its own.
 */
function readCalendarChoice(
  form: FormData,
): { calendar?: ReturnType<typeof getWriteCalendar>; error?: string } {
  if (!form.has("calendar_id")) return { calendar: getWriteCalendar() };
  const choice = text(form, "calendar_id", 20);
  if (choice === "" || choice === "none") return { calendar: null };

  const calendar = getWritableCalendar(Number(choice));
  if (!calendar) {
    return {
      error:
        "That calendar can't be written to any more. Pick another one, " +
        "or check it in Setup.",
    };
  }
  return { calendar };
}

export async function addHouseholdEvent(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  await requireSession();

  const read = readEventForm(form);
  if (!read.draft) return { error: read.error };
  const { title, notes, startsAt, endsAt, allDay } = read.draft;

  const choice = readCalendarChoice(form);
  if (choice.error) return { error: choice.error };
  const writeCalendar = choice.calendar;

  // An iCloud calendar means the event belongs in iCloud first — that's what
  // makes it show up in the Calendar app on both phones rather than only here.
  let remote: { url: string; etag: string | null } | null = null;
  let uid: string | null = null;

  if (writeCalendar) {
    const account = writeAccountFor(writeCalendar.account_id);
    if (!account) return { error: "That iCloud account is no longer connected." };

    uid = `agenda-${crypto.randomUUID()}`;
    try {
      remote = await createRemoteEvent(account, writeCalendar.url, {
        uid,
        summary: title,
        notes,
        startsAt,
        endsAt,
        allDay,
      });
    } catch (err) {
      // Deliberately not saving locally on failure. A local-only copy that the
      // user believes is in their calendar is worse than a clear error.
      return {
        error: `Couldn't add it to iCloud: ${
          err instanceof Error ? err.message : String(err)
        }`,
      };
    }
  }

  db.prepare(
    `INSERT INTO household_events
       (title, notes, starts_at, ends_at, all_day,
        caldav_calendar_id, caldav_url, caldav_uid, caldav_etag)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    title,
    notes,
    startsAt,
    endsAt,
    allDay ? 1 : 0,
    writeCalendar?.id ?? null,
    remote?.url ?? null,
    uid,
    remote?.etag ?? null,
  );

  await announceApartmentEvent("added", title, startsAt, allDay);
  refreshViews();
  return {
    ok: writeCalendar
      ? `Added "${title}" to ${writeCalendar.display_name} in iCloud.`
      : `Added "${title}".`,
  };
}

type StoredHouseholdEvent = {
  id: number;
  title: string;
  caldav_calendar_id: number | null;
  caldav_url: string | null;
  caldav_uid: string | null;
  caldav_etag: string | null;
};

/**
 * Change an event that was created here.
 *
 * Only these — a feed event belongs to whoever published it, and a chore's
 * dates belong to the rotation. Both say so in the UI rather than offering an
 * edit that couldn't stick.
 *
 * The awkward case is moving an event to a *different* iCloud calendar, which
 * CalDAV has no move for: it's a create in the new one and a delete from the
 * old. Done in that order on purpose. Creating first means a failure leaves the
 * original untouched, and the worst case is a duplicate that gets reported —
 * whereas deleting first would put a failed create between the user and an
 * event that no longer exists anywhere.
 */
export async function updateHouseholdEvent(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  await requireSession();

  const eventId = Number(text(form, "event_id", 20));
  const existing = db
    .prepare<[number], StoredHouseholdEvent>(
      `SELECT id, title, caldav_calendar_id, caldav_url, caldav_uid, caldav_etag
       FROM household_events WHERE id = ?`,
    )
    .get(eventId);
  if (!existing) return { error: "That event no longer exists." };

  const read = readEventForm(form);
  if (!read.draft) return { error: read.error };
  const { title, notes, startsAt, endsAt, allDay } = read.draft;

  const choice = readCalendarChoice(form);
  if (choice.error) return { error: choice.error };
  const target = choice.calendar ?? null;

  const stayingPut =
    target !== null &&
    existing.caldav_url !== null &&
    existing.caldav_calendar_id === target.id;

  let url = existing.caldav_url;
  let uid = existing.caldav_uid;
  let etag = existing.caldav_etag;
  let strandedCopy = false;

  try {
    if (stayingPut) {
      const account = writeAccountFor(target.account_id);
      if (!account) return { error: "That iCloud account is no longer connected." };
      const written = await updateRemoteEvent(
        account,
        existing.caldav_url!,
        existing.caldav_etag,
        {
          uid: existing.caldav_uid ?? `agenda-${crypto.randomUUID()}`,
          summary: title,
          notes,
          startsAt,
          endsAt,
          allDay,
        },
      );
      url = written.url;
      etag = written.etag;
    } else {
      // New home (or its first one): write there before touching the old copy.
      if (target) {
        const account = writeAccountFor(target.account_id);
        if (!account) {
          return { error: "That iCloud account is no longer connected." };
        }
        const newUid = `agenda-${crypto.randomUUID()}`;
        const written = await createRemoteEvent(account, target.url, {
          uid: newUid,
          summary: title,
          notes,
          startsAt,
          endsAt,
          allDay,
        });
        uid = newUid;
        url = written.url;
        etag = written.etag;
      } else {
        url = null;
        uid = null;
        etag = null;
      }

      // Then clear out where it used to live.
      if (existing.caldav_url && existing.caldav_calendar_id) {
        const previous = db
          .prepare<[number], { account_id: number }>(
            "SELECT account_id FROM caldav_calendars WHERE id = ?",
          )
          .get(existing.caldav_calendar_id);
        const account = previous ? writeAccountFor(previous.account_id) : undefined;
        if (account) {
          try {
            await deleteRemoteEvent(
              account,
              existing.caldav_url,
              existing.caldav_etag,
            );
            forgetCachedEvent(existing.caldav_uid);
          } catch {
            // The new copy is the real one now, so the edit still saves — but
            // there's an orphan in the old calendar and the user is the only
            // one who can clear it.
            strandedCopy = true;
          }
        }
      }
    }
  } catch (err) {
    // Same rule as adding: don't save locally if iCloud didn't take it, or the
    // app would show an edit the Calendar app has never heard of.
    return {
      error: `Couldn't save the change to iCloud: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }

  db.prepare(
    `UPDATE household_events
     SET title = ?, notes = ?, starts_at = ?, ends_at = ?, all_day = ?,
         caldav_calendar_id = ?, caldav_url = ?, caldav_uid = ?, caldav_etag = ?
     WHERE id = ?`,
  ).run(
    title,
    notes,
    startsAt,
    endsAt,
    allDay ? 1 : 0,
    target?.id ?? null,
    url,
    uid,
    etag,
    eventId,
  );

  await announceApartmentEvent("moved", title, startsAt, allDay);
  refreshViews();
  if (strandedCopy) {
    return {
      ok:
        `Saved "${title}", but the old copy couldn't be removed from the ` +
        `calendar it was in. Delete that one in your Calendar app.`,
    };
  }
  return { ok: `Saved "${title}".` };
}

export async function removeHouseholdEvent(eventId: number): Promise<void> {
  await requireSession();

  const event = db
    .prepare<
      [number],
      {
        title: string;
        starts_at: string;
        all_day: number;
        caldav_calendar_id: number | null;
        caldav_url: string | null;
        caldav_uid: string | null;
        caldav_etag: string | null;
      }
    >(
      `SELECT title, starts_at, all_day,
              caldav_calendar_id, caldav_url, caldav_uid, caldav_etag
       FROM household_events WHERE id = ?`,
    )
    .get(eventId);
  if (!event) return;

  if (event.caldav_url && event.caldav_calendar_id) {
    const calendar = db
      .prepare<[number], { account_id: number }>(
        "SELECT account_id FROM caldav_calendars WHERE id = ?",
      )
      .get(event.caldav_calendar_id);
    const account = calendar ? writeAccountFor(calendar.account_id) : undefined;
    if (account) {
      try {
        await deleteRemoteEvent(account, event.caldav_url, event.caldav_etag);
      } catch {
        // If iCloud can't be reached, keep the local row. Removing it here
        // would strand the event in their real calendar with nothing left in
        // the app pointing at it, and no way to try again.
        return;
      }
    }
  }

  db.prepare("DELETE FROM household_events WHERE id = ?").run(eventId);
  forgetCachedEvent(event.caldav_uid);
  await announceApartmentEvent(
    "cancelled",
    event.title,
    event.starts_at,
    event.all_day === 1,
  );
  refreshViews();
}

/* ------------------------------------------------------------------ chores */

export async function addChore(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  await requireSession();

  const title = text(form, "title", 120);
  const cadence = Number(text(form, "cadence_days", 5)) || 7;
  const ownerRaw = text(form, "owner", 20);
  const rotates = ownerRaw === "rotate";

  if (!title) return { error: "The chore needs a name." };
  if (cadence < 1 || cadence > 365) {
    return { error: "Repeat every 1 to 365 days." };
  }

  const startOn = text(form, "start_on", 10) || today(timezone());
  db.prepare(
    `INSERT INTO chores (title, cadence_days, rotates, fixed_owner_id, next_due_on)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(
    title,
    cadence,
    rotates ? 1 : 0,
    rotates ? null : Number(ownerRaw) || null,
    startOn,
  );

  refreshViews();
  return { ok: `Added "${title}".` };
}

/**
 * Change a chore's name, how often it comes round, whose it is, or when it's
 * next due.
 *
 * `rotation_index` is left alone on purpose. It's the count of how many turns
 * have been taken, and renaming the bins chore or moving it to Fridays doesn't
 * mean the person who did it last should do it again.
 */
export async function updateChore(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  await requireSession();

  const choreId = Number(text(form, "chore_id", 20));
  const title = text(form, "title", 120);
  const cadence = Number(text(form, "cadence_days", 5)) || 7;
  const ownerRaw = text(form, "owner", 20);
  const rotates = ownerRaw === "rotate";
  const dueOn = text(form, "next_due_on", 10);

  if (!choreId) return { error: "" };
  if (!title) return { error: "The chore needs a name." };
  if (cadence < 1 || cadence > 365) {
    return { error: "Repeat every 1 to 365 days." };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueOn)) return { error: "Pick a due date." };

  const info = db
    .prepare(
      `UPDATE chores
       SET title = ?, cadence_days = ?, rotates = ?, fixed_owner_id = ?,
           next_due_on = ?
       WHERE id = ? AND archived = 0`,
    )
    .run(
      title,
      cadence,
      rotates ? 1 : 0,
      rotates ? null : Number(ownerRaw) || null,
      dueOn,
      choreId,
    );
  if (info.changes === 0) return { error: "That chore no longer exists." };

  refreshViews();
  return { ok: `Saved "${title}".` };
}

export async function completeChore(choreId: number): Promise<void> {
  await requireSession();

  const chore = db
    .prepare<
      [number],
      {
        id: number;
        cadence_days: number;
        rotates: number;
        fixed_owner_id: number | null;
        next_due_on: string;
        rotation_index: number;
      }
    >("SELECT * FROM chores WHERE id = ?")
    .get(choreId);
  if (!chore) return;

  const who = assigneeFor(chore, getPeople());
  const now = today(timezone());
  // Schedule from whichever is later, so a chore that slipped a week doesn't
  // immediately come due again the moment it's finally done.
  const base = chore.next_due_on > now ? chore.next_due_on : now;

  db.transaction(() => {
    db.prepare(
      `INSERT INTO chore_completions (chore_id, person_id, due_on)
       VALUES (?, ?, ?)`,
    ).run(choreId, who?.id ?? null, chore.next_due_on);
    db.prepare(
      `UPDATE chores
       SET next_due_on = ?, rotation_index = rotation_index + 1
       WHERE id = ?`,
    ).run(addDays(base, chore.cadence_days), choreId);
  })();

  refreshViews();
}

export async function snoozeChore(choreId: number): Promise<void> {
  await requireSession();
  const chore = db
    .prepare<[number], { next_due_on: string }>(
      "SELECT next_due_on FROM chores WHERE id = ?",
    )
    .get(choreId);
  if (!chore) return;
  const now = today(timezone());
  const base = chore.next_due_on > now ? chore.next_due_on : now;
  db.prepare("UPDATE chores SET next_due_on = ? WHERE id = ?").run(
    addDays(base, 1),
    choreId,
  );
  refreshViews();
}

export async function removeChore(choreId: number): Promise<void> {
  await requireSession();
  db.prepare("UPDATE chores SET archived = 1 WHERE id = ?").run(choreId);
  refreshViews();
}

/* -------------------------------------------------------------------- list */

/**
 * The key a remembered price is filed under: lowercased, punctuation-light,
 * whitespace collapsed. "Oat Milk " and "oat milk" are the same purchase.
 */
function priceKey(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function rememberPrice(text: string, cents: number): void {
  const key = priceKey(text);
  if (!key) return;
  db.prepare(
    `INSERT INTO price_memory (name, label, price_cents, recorded_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(name) DO UPDATE SET
       label = excluded.label,
       price_cents = excluded.price_cents,
       recorded_at = excluded.recorded_at`,
  ).run(key, text, cents);
}

function recallPrice(text: string): number | null {
  const key = priceKey(text);
  if (!key) return null;
  const row = db
    .prepare<[string], { price_cents: number }>(
      "SELECT price_cents FROM price_memory WHERE name = ?",
    )
    .get(key);
  return row?.price_cents ?? null;
}

/** Dollars as typed ("4.29", "$4.29") to whole cents. */
function priceToCents(raw: string): number | null {
  const cleaned = raw.replace(/[^0-9.]/g, "");
  if (!cleaned) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value < 0 || value > 1_000_000) return null;
  return Math.round(value * 100);
}

/**
 * Whose an item is: a person id, or null for the apartment.
 *
 * The picker sends the literal 'household' for the flat. Anything unparseable
 * lands on null too, which is the safe end — an item nobody is named on reads
 * as shared, where a wrong name reads as an accusation about who wanted it.
 */
function readOwner(form: FormData): number | null {
  const raw = text(form, "added_by", 20);
  if (raw === "" || raw === "household") return null;
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function addListItem(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  await requireSession();
  const itemText = text(form, "text", 200);
  const addedBy = readOwner(form);
  const category = text(form, "category", 10) === "want" ? "want" : "need";
  if (!itemText) return { error: "" };

  if (category === "need") {
    // Seed from what this cost last time, so the memory survives the list
    // being cleared — which is the normal way a shopping list is used.
    db.prepare(
      `INSERT INTO list_items (text, added_by, category, last_price_cents)
       VALUES (?, ?, 'need', ?)`,
    ).run(itemText, addedBy, recallPrice(itemText));
    await announceListAddition(itemText);
    refreshViews();
    return { ok: "" };
  }

  // Pasting a link is how you add anything Best Buy doesn't sell, and it
  // needs no extra field: a URL is unmistakable, so the box takes either. The
  // item is named from the page on the first check.
  const pastedLink = looksLikeUrl(itemText);

  const info = pastedLink
    ? db
        .prepare(
          `INSERT INTO list_items
             (text, added_by, category, retailer, retailer_url)
           VALUES (?, ?, 'want', 'link', ?)`,
        )
        .run(shopName(itemText), addedBy, itemText)
    // Otherwise it's a Best Buy search, stored as text until a check binds it
    // to a real SKU, so nothing here has to know their model numbering.
    : db
        .prepare(
          `INSERT INTO list_items
             (text, added_by, category, retailer, retailer_query)
           VALUES (?, ?, 'want', 'bestbuy', ?)`,
        )
        .run(itemText, addedBy, text(form, "search", 200) || itemText);

  const newId = Number(info.lastInsertRowid);
  const result = await refreshOneWant(newId);
  let label = itemText;

  if (pastedLink) {
    // A raw URL is a terrible name for a wish list. Take the product name the
    // page gave us, and only here — a later check must not rename something
    // the user has since called what they want to call it.
    const named = db
      .prepare<[number], { retailer_name: string | null }>(
        "SELECT retailer_name FROM list_items WHERE id = ?",
      )
      .get(newId);
    label = named?.retailer_name?.slice(0, 200) || shopName(itemText);
    db.prepare("UPDATE list_items SET text = ? WHERE id = ?").run(label, newId);
  }

  await announceListAddition(label);
  refreshViews();
  if (result.error) {
    // The item is kept either way — it's still something they want, it just
    // has no price yet.
    return { ok: `Added "${label}". ${result.error}` };
  }
  return { ok: `Added "${label}".` };
}

/**
 * Tell the *other* phone that the apartment calendar changed.
 *
 * The apartment calendar is the one thing in here that is nobody's and both
 * people's, so a landlord visit appearing — or moving, or being called off — is
 * news to whoever didn't do it. Same rule as the shopping list: the adder comes
 * from the device cookie, and a phone that never turned notifications on stays
 * silent rather than being told about its own typing.
 */
async function announceApartmentEvent(
  verb: "added" | "moved" | "cancelled",
  title: string,
  startsAt: string,
  allDay: boolean,
): Promise<void> {
  const actor = await devicePerson();
  if (actor === null) return;
  const name = getPeople().find((p) => p.id === actor)?.name;
  const tz = timezone();
  const day = eventDayKey(startsAt, allDay, tz);
  const when = allDay
    ? `${formatDayLabel(day, tz)}, all day`
    : `${formatDayLabel(day, tz)} at ${formatTime(startsAt, tz)}`;

  await notifyOthers(actor, {
    title:
      verb === "cancelled"
        ? `Off the apartment calendar: ${title}`
        : `${title} — ${when}`,
    body:
      verb === "cancelled"
        ? `${name ?? "Someone"} removed it.`
        : `${name ?? "Someone"} ${verb} it on the apartment calendar.`,
    url: "/calendar?view=day&date=" + day,
    // Keyed to the event so a title typed, then corrected, replaces itself
    // rather than arriving twice.
    tag: `apt-event-${title.toLowerCase().replace(/\W+/g, "-").slice(0, 40)}`,
  }).catch(() => undefined);
}

/**
 * Tell the *other* phone something appeared on the list.
 *
 * Whose phone did the adding comes from the device cookie, not from the item's
 * owner tag — those are different questions, and most items are tagged as the
 * apartment's. Without knowing the adder this would buzz you about your own
 * shopping, so a phone that never turned notifications on stays silent rather
 * than guessing.
 */
async function announceListAddition(label: string): Promise<void> {
  const adder = await devicePerson();
  if (adder === null) return;
  const name = getPeople().find((p) => p.id === adder)?.name;
  await notifyOthers(adder, {
    title: "Added to the shopping list",
    body: name ? `${name} added ${label}.` : `Someone added ${label}.`,
    url: "/list",
    tag: "list-added",
  });
}

/** Where a Want's price comes from, as the edit form spells it. */
function readPriceSource(form: FormData): "bestbuy" | "link" | null {
  const raw = text(form, "source", 20);
  if (raw === "link") return "link";
  if (raw === "manual") return null;
  return "bestbuy";
}

/**
 * Rename something on the list — and, for a Want, change where its price
 * comes from.
 *
 * Renaming a Need re-reads the price memory under the new name, because the
 * memory is keyed by name: correcting "otmilk" to "oat milk" should pick up
 * what oat milk actually costs rather than keep a price filed under a typo.
 *
 * A Want is re-checked when anything about *where* the price comes from
 * changes — the source, the search text, or the link. Each of those clears the
 * bound product, because the binding belongs to the old target: leaving a Best
 * Buy SKU in place after switching to a link would mean the change did nothing
 * and the price kept arriving from the old television.
 */
export async function updateListItem(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  await requireSession();

  const itemId = Number(text(form, "item_id", 20));
  const itemText = text(form, "text", 200);
  const addedBy = readOwner(form);
  if (!itemId) return { error: "" };
  if (!itemText) return { error: "It needs a name." };

  const item = db
    .prepare<
      [number],
      {
        category: string;
        retailer: string | null;
        retailer_query: string | null;
        retailer_url: string | null;
      }
    >(
      `SELECT category, retailer, retailer_query, retailer_url
       FROM list_items WHERE id = ?`,
    )
    .get(itemId);
  if (!item) return { error: "That item no longer exists." };

  if (item.category !== "want") {
    db.prepare(
      `UPDATE list_items
       SET text = ?, added_by = ?, last_price_cents = ?
       WHERE id = ?`,
    ).run(itemText, addedBy, recallPrice(itemText), itemId);
    refreshViews();
    return { ok: `Saved "${itemText}".` };
  }

  const source = readPriceSource(form);
  // Blank means "search for whatever it's called now", which is what someone
  // clearing the field is asking for.
  const query = text(form, "search", 200) || itemText;
  const link = text(form, "url", 500) || null;

  if (source === "link" && !link) {
    return { error: "Paste the product's web address, or pick another source." };
  }
  if (source === "link" && !looksLikeUrl(link!)) {
    return { error: "That doesn't look like a web address — it should start with https://." };
  }

  const retargeted =
    source !== item.retailer ||
    (source === "bestbuy" && query !== item.retailer_query) ||
    (source === "link" && link !== item.retailer_url);

  db.prepare(
    `UPDATE list_items
     SET text = ?, added_by = ?, retailer = ?, retailer_query = ?,
         retailer_url  = CASE WHEN ? THEN ? ELSE retailer_url END,
         retailer_sku  = CASE WHEN ? THEN NULL ELSE retailer_sku END,
         retailer_name = CASE WHEN ? THEN NULL ELSE retailer_name END,
         price_error   = NULL
     WHERE id = ?`,
  ).run(
    itemText,
    addedBy,
    source,
    query,
    retargeted ? 1 : 0,
    // A link keeps its URL; the other two have no business holding one, and a
    // stale "View at Best Buy" against a hand-typed price is a small lie.
    source === "link" ? link : null,
    retargeted ? 1 : 0,
    retargeted ? 1 : 0,
    itemId,
  );

  if (retargeted && source !== null) {
    const result = await refreshOneWant(itemId);
    refreshViews();
    if (result.error) return { ok: `Saved "${itemText}". ${result.error}` };
  } else {
    refreshViews();
  }
  return { ok: `Saved "${itemText}".` };
}

/** Record what a Need actually cost, when ticking it off. */
export async function setItemPrice(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  await requireSession();
  const itemId = Number(text(form, "item_id", 20));
  const cents = priceToCents(text(form, "price", 20));
  if (!itemId) return { error: "" };
  if (cents === null) return { error: "That doesn't look like a price." };

  const item = db
    .prepare<[number], { text: string }>(
      "SELECT text FROM list_items WHERE id = ?",
    )
    .get(itemId);
  if (!item) return { error: "" };

  db.transaction(() => {
    db.prepare(
      `UPDATE list_items
       SET last_price_cents = ?, last_price_at = datetime('now')
       WHERE id = ?`,
    ).run(cents, itemId);
    db.prepare(
      "INSERT INTO price_history (item_id, price_cents, source) VALUES (?, ?, 'manual')",
    ).run(itemId, cents);
    rememberPrice(item.text, cents);
  })();

  refreshViews();
  return { ok: "" };
}

/**
 * Type in what a Want costs today.
 *
 * The retailer lookup is the point of the Wants list, but it needs an API key,
 * and a key can be weeks away — or refused. Rather than leave the list inert
 * until then, a price can be entered by hand: same row, same history, same
 * up-and-down arrows. When a key does arrive, a check overwrites the current
 * price and everything typed stays in the history behind it.
 *
 * `price_source` is what keeps this honest — the app says "you entered this"
 * rather than "checked just now" for a number nobody checked.
 */
export async function setWantPrice(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  await requireSession();
  const itemId = Number(text(form, "item_id", 20));
  const cents = priceToCents(text(form, "price", 20));
  if (!itemId) return { error: "" };
  if (cents === null) return { error: "That doesn't look like a price." };

  const item = db
    .prepare<[number], { id: number }>(
      "SELECT id FROM list_items WHERE id = ? AND category = 'want'",
    )
    .get(itemId);
  if (!item) return { error: "" };

  db.transaction(() => {
    // regular_price_cents is cleared: a struck-through "was $X" is a claim
    // about a sale, and a hand-typed figure isn't evidence of one.
    db.prepare(
      `UPDATE list_items
       SET price_cents = ?, regular_price_cents = NULL,
           price_checked_at = datetime('now'), price_source = 'manual',
           price_error = NULL
       WHERE id = ?`,
    ).run(cents, itemId);
    db.prepare(
      "INSERT INTO price_history (item_id, price_cents, source) VALUES (?, ?, 'manual')",
    ).run(itemId, cents);
  })();

  refreshViews();
  return { ok: "" };
}

/** Check one Want's price now. */
export async function checkWantPrice(itemId: number): Promise<void> {
  await requireSession();
  await refreshOneWant(itemId);
  refreshViews();
}

/** Check every Want. */
export async function checkAllWantPrices(): Promise<void> {
  await requireSession();
  await refreshWantPrices();
  refreshViews();
}

export async function toggleListItem(itemId: number): Promise<void> {
  await requireSession();
  db.prepare(
    `UPDATE list_items
     SET checked_at = CASE WHEN checked_at IS NULL THEN datetime('now') ELSE NULL END
     WHERE id = ?`,
  ).run(itemId);
  refreshViews();
}

/**
 * Remove one item for good.
 *
 * Deliberately leaves `price_memory` alone: forgetting the item is not the
 * same as forgetting what it costs, and adding it back next week should still
 * say "last time $4.29". Setup can clear the memory outright if that's wanted.
 */
export async function deleteListItem(itemId: number): Promise<void> {
  await requireSession();
  db.prepare("DELETE FROM list_items WHERE id = ?").run(itemId);
  refreshViews();
}

export async function clearCheckedItems(
  category: "need" | "want" = "need",
): Promise<void> {
  await requireSession();
  db.prepare(
    "DELETE FROM list_items WHERE checked_at IS NOT NULL AND category = ?",
  ).run(category);
  refreshViews();
}
