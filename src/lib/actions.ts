"use server";

import crypto from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db, setSetting } from "./db";
import {
  endSession,
  isPasscodeSet,
  isSignedIn,
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
import { addDays, today } from "./dates";
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
  type StoredAccount,
} from "./caldav";
import { canStoreSecrets, encryptSecret } from "./secrets";

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

function writeAccountFor(calendarAccountId: number): StoredAccount | undefined {
  return db
    .prepare<[number], StoredAccount>(
      "SELECT id, server_url, username, password_enc FROM caldav_accounts WHERE id = ?",
    )
    .get(calendarAccountId);
}

/* -------------------------------------------------------- household events */

export async function addHouseholdEvent(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  await requireSession();

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

  let startsAt: string;
  let endsAt: string;

  if (allDay) {
    startsAt = date;
    endsAt = addDays(date, 1); // all-day DTEND is exclusive
  } else {
    // The form collects wall-clock time in the household timezone; convert to
    // the UTC instant the rest of the app stores.
    startsAt = wallClockToUtc(date, startTime, timezone());
    endsAt = endTime
      ? wallClockToUtc(date, endTime, timezone())
      : new Date(Date.parse(startsAt) + 3_600_000).toISOString();
    if (Date.parse(endsAt) < Date.parse(startsAt)) {
      return { error: "The end time is before the start time." };
    }
  }

  // Where this one goes. The form sends a choice per event, pre-selected with
  // the Setup default; a submission without the field (an older cached page)
  // falls back to that default on its own.
  let writeCalendar;
  if (!form.has("calendar_id")) {
    writeCalendar = getWriteCalendar();
  } else {
    const choice = text(form, "calendar_id", 20);
    if (choice === "" || choice === "none") {
      writeCalendar = null;
    } else {
      writeCalendar = getWritableCalendar(Number(choice));
      if (!writeCalendar) {
        return {
          error:
            "That calendar can't be written to any more. Pick another one, " +
            "or check it in Setup.",
        };
      }
    }
  }

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

  refreshViews();
  return {
    ok: writeCalendar
      ? `Added "${title}" to ${writeCalendar.display_name} in iCloud.`
      : `Added "${title}".`,
  };
}

/**
 * '2026-07-27' + '18:30' in America/New_York → '2026-07-27T22:30:00.000Z'.
 *
 * Derives the zone's offset at that moment by formatting a provisional
 * instant back into the zone and measuring the drift, which avoids pulling in
 * a timezone library for the one place we need this direction.
 */
function wallClockToUtc(date: string, time: string, timeZone: string): string {
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

export async function removeHouseholdEvent(eventId: number): Promise<void> {
  await requireSession();

  const event = db
    .prepare<
      [number],
      {
        caldav_calendar_id: number | null;
        caldav_url: string | null;
        caldav_etag: string | null;
      }
    >(
      `SELECT caldav_calendar_id, caldav_url, caldav_etag
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

export async function addListItem(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  await requireSession();
  const itemText = text(form, "text", 200);
  const addedBy = Number(text(form, "added_by", 20)) || null;
  if (!itemText) return { error: "" };
  db.prepare("INSERT INTO list_items (text, added_by) VALUES (?, ?)").run(
    itemText,
    addedBy,
  );
  refreshViews();
  return { ok: "" };
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

export async function clearCheckedItems(): Promise<void> {
  await requireSession();
  db.prepare("DELETE FROM list_items WHERE checked_at IS NOT NULL").run();
  refreshViews();
}
