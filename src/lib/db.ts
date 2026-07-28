import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { REQUESTED_COLORS, normalizeName } from "./colors";

/**
 * SQLite lives on disk so the two of us see the same data. In dev that's
 * ./data/agenda.db; in production set AGENDA_DB_PATH to a path on a
 * persistent volume (see README).
 */
const DB_PATH =
  process.env.AGENDA_DB_PATH ?? path.join(process.cwd(), "data", "agenda.db");

declare global {
  // Next.js hot-reloads modules in dev; without this we'd open a new
  // connection on every edit and eventually run out of file handles.
  var __agendaDb: Database.Database | undefined;
}

function open(): Database.Database {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  // If another process is mid-migration, wait for it rather than failing
  // instantly with SQLITE_BUSY.
  db.pragma("busy_timeout = 10000");

  // Serialise migration across processes. BEGIN IMMEDIATE takes the write
  // lock up front, so a second process starting at the same moment blocks
  // here and then sees the finished schema instead of racing halfway through
  // it — which is exactly what happens when Next.js runs several build
  // workers at once.
  db.exec("BEGIN IMMEDIATE");
  try {
    migrate(db);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  return db;
}

function columnsOf(db: Database.Database, table: string): string[] {
  return db
    .prepare<[], { name: string }>(`PRAGMA table_info(${table})`)
    .all()
    .map((c) => c.name);
}

function migrate(db: Database.Database) {
  // Must run before the schema below. `events` gained a calendar_id column,
  // and the schema creates an index on it — against a database created by an
  // earlier version that statement throws "no such column" and takes the whole
  // migration down with it, before any of the fix-ups further down can run.
  //
  // Dropping is safe and cheap because this table is only ever a cache of what
  // the calendar sources returned; the next sync rebuilds it. CREATE TABLE
  // IF NOT EXISTS below then makes it in the current shape.
  const existingEventColumns = columnsOf(db, "events");
  if (
    existingEventColumns.length > 0 &&
    !existingEventColumns.includes("calendar_id")
  ) {
    db.exec("DROP TABLE events");
    if (columnsOf(db, "feeds").length > 0) {
      db.exec("UPDATE feeds SET last_synced_at = NULL");
    }
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS people (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL,
      color      TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- One published iCloud .ics URL. person_id is null for a calendar that
    -- belongs to the household rather than to one of us.
    CREATE TABLE IF NOT EXISTS feeds (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      person_id      INTEGER REFERENCES people(id) ON DELETE CASCADE,
      label          TEXT NOT NULL,
      url            TEXT NOT NULL,
      last_synced_at TEXT,
      last_error     TEXT,
      created_at     TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- An iCloud account reached over CalDAV. Unlike a published feed this is
    -- read *and* write, which is why it needs credentials.
    CREATE TABLE IF NOT EXISTS caldav_accounts (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      person_id   INTEGER REFERENCES people(id) ON DELETE CASCADE,
      label       TEXT NOT NULL,
      server_url  TEXT NOT NULL,
      username    TEXT NOT NULL,
      password_enc TEXT NOT NULL,   -- AES-256-GCM, see lib/secrets.ts
      last_error  TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS caldav_calendars (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id     INTEGER NOT NULL REFERENCES caldav_accounts(id) ON DELETE CASCADE,
      url            TEXT NOT NULL,
      display_name   TEXT NOT NULL,
      read_only      INTEGER NOT NULL DEFAULT 0,
      enabled        INTEGER NOT NULL DEFAULT 1,
      last_synced_at TEXT,
      last_error     TEXT,
      UNIQUE(account_id, url)
    );

    -- Occurrences expanded from every source. This whole table is a cache:
    -- a sync deletes and rebuilds one source's rows, so nothing the user
    -- typed ever lives here. Exactly one of feed_id / calendar_id is set.
    CREATE TABLE IF NOT EXISTS events (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      feed_id     INTEGER REFERENCES feeds(id) ON DELETE CASCADE,
      calendar_id INTEGER REFERENCES caldav_calendars(id) ON DELETE CASCADE,
      uid         TEXT NOT NULL,
      summary     TEXT NOT NULL,
      location    TEXT,
      starts_at   TEXT NOT NULL,  -- all-day: 'YYYY-MM-DD', timed: ISO UTC
      ends_at     TEXT NOT NULL,
      all_day     INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS events_starts_idx   ON events(starts_at);
    CREATE INDEX IF NOT EXISTS events_feed_idx     ON events(feed_id);
    CREATE INDEX IF NOT EXISTS events_calendar_idx ON events(calendar_id);

    -- Events created in the app. The iCloud feeds are read-only, so this is
    -- how household stuff gets onto the calendar.
    CREATE TABLE IF NOT EXISTS household_events (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      title      TEXT NOT NULL,
      notes      TEXT,
      starts_at  TEXT NOT NULL,
      ends_at    TEXT NOT NULL,
      all_day    INTEGER NOT NULL DEFAULT 0,
      created_by INTEGER REFERENCES people(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      -- The counterpart in iCloud, when one was written. Null means this
      -- event lives only in this app.
      caldav_calendar_id INTEGER,
      caldav_url         TEXT,
      caldav_uid         TEXT,
      caldav_etag        TEXT
    );
    CREATE INDEX IF NOT EXISTS household_events_starts_idx
      ON household_events(starts_at);

    CREATE TABLE IF NOT EXISTS chores (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      title          TEXT NOT NULL,
      cadence_days   INTEGER NOT NULL DEFAULT 7,
      rotates        INTEGER NOT NULL DEFAULT 1,
      fixed_owner_id INTEGER REFERENCES people(id) ON DELETE SET NULL,
      next_due_on    TEXT NOT NULL,          -- 'YYYY-MM-DD'
      rotation_index INTEGER NOT NULL DEFAULT 0,
      archived       INTEGER NOT NULL DEFAULT 0,
      created_at     TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Append-only record of every completed turn, so "who did it last" and
    -- the rotation can't drift apart.
    CREATE TABLE IF NOT EXISTS chore_completions (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      chore_id    INTEGER NOT NULL REFERENCES chores(id) ON DELETE CASCADE,
      person_id   INTEGER REFERENCES people(id) ON DELETE SET NULL,
      due_on      TEXT NOT NULL,
      completed_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS chore_completions_chore_idx
      ON chore_completions(chore_id, completed_at DESC);

    CREATE TABLE IF NOT EXISTS list_items (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      text       TEXT NOT NULL,
      added_by   INTEGER REFERENCES people(id) ON DELETE SET NULL,
      checked_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // --- changes to tables that already exist in someone's database ---

  // Bring a database made by an earlier version up to the shape above. The
  // create statement already includes these, so this only fires on an
  // existing database.
  //
  // Checking first and adding second is a race when two processes start
  // together — Next.js does exactly that during a build — and the loser's
  // ALTER fails on a column the winner just added. Both halves of the check
  // are therefore belt and braces: skip what's there, and treat "already
  // exists" as success rather than an error.
  const householdColumns = columnsOf(db, "household_events");
  for (const [name, type] of [
    ["caldav_calendar_id", "INTEGER"],
    ["caldav_url", "TEXT"],
    ["caldav_uid", "TEXT"],
    ["caldav_etag", "TEXT"],
  ] as const) {
    if (householdColumns.includes(name)) continue;
    try {
      db.exec(`ALTER TABLE household_events ADD COLUMN ${name} ${type}`);
    } catch (err) {
      if (!/duplicate column name/i.test(String(err))) throw err;
    }
  }

  applyRequestedColors(db);
}

/**
 * The household asked for particular colours — red for Nino, blue for João —
 * rather than the ones the palette handed out when they signed up. Names are
 * the only stable way to tell who is who; ids just record who was typed in
 * first.
 *
 * Runs once and leaves a marker, so colours changed in Setup afterwards are
 * never overwritten. A name that matches nothing is left alone.
 */
function applyRequestedColors(db: Database.Database) {
  const marker = "requested_colors_applied";
  const done = db
    .prepare<[string], { value: string }>(
      "SELECT value FROM settings WHERE key = ?",
    )
    .get(marker);
  if (done) return;

  const people = db
    .prepare<[], { id: number; name: string }>("SELECT id, name FROM people")
    .all();
  const update = db.prepare("UPDATE people SET color = ? WHERE id = ?");
  for (const person of people) {
    const name = normalizeName(person.name);
    const wanted = REQUESTED_COLORS.find((c) => name.includes(c.match));
    if (wanted) update.run(wanted.color, person.id);
  }

  db.prepare("INSERT INTO settings (key, value) VALUES (?, '1')").run(marker);
}

function connection(): Database.Database {
  return (globalThis.__agendaDb ??= open());
}

/**
 * Opened on first query, not on import.
 *
 * Importing this module used to open and migrate the database immediately,
 * which meant `next build` did it too: collecting page data loads every route
 * module, in several worker processes at once, so a build would create a
 * database purely as a side effect and occasionally fail when two workers
 * migrated the same file simultaneously. Nothing about building the app should
 * touch the household's data.
 */
export const db: Database.Database = new Proxy({} as Database.Database, {
  get(_target, property, receiver) {
    const real = connection();
    const value = Reflect.get(real, property, receiver);
    return typeof value === "function" ? value.bind(real) : value;
  },
  set(_target, property, value) {
    return Reflect.set(connection(), property, value);
  },
});

export function getSetting(key: string): string | null {
  const row = db
    .prepare<[string], { value: string }>(
      "SELECT value FROM settings WHERE key = ?",
    )
    .get(key);
  return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(key, value);
}
