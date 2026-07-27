import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

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
  migrate(db);
  return db;
}

function migrate(db: Database.Database) {
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

    -- Occurrences expanded from the feeds. This whole table is a cache:
    -- sync deletes and rebuilds a feed's rows, so nothing the user typed
    -- ever lives here.
    CREATE TABLE IF NOT EXISTS events (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      feed_id   INTEGER NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
      uid       TEXT NOT NULL,
      summary   TEXT NOT NULL,
      location  TEXT,
      starts_at TEXT NOT NULL,  -- all-day: 'YYYY-MM-DD', timed: ISO UTC
      ends_at   TEXT NOT NULL,
      all_day   INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS events_starts_idx ON events(starts_at);
    CREATE INDEX IF NOT EXISTS events_feed_idx   ON events(feed_id);

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
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
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
}

export const db: Database.Database =
  globalThis.__agendaDb ?? (globalThis.__agendaDb = open());

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
