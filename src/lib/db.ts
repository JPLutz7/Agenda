import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import {
  REQUESTED_COLORS,
  looksLikeSharedCalendar,
  normalizeName,
} from "./colors";

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

function tableExists(db: Database.Database, table: string): boolean {
  return (
    db
      .prepare<[string], { name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
      )
      .get(table) !== undefined
  );
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

  // Also before the schema below, and for the same reason in reverse: the app
  // used to call the flat "the household" and now calls it the dorm, so
  // `household_events` becomes `dorm_events`. This has to happen before the
  // CREATE TABLE IF NOT EXISTS further down, or that would make an empty
  // dorm_events and the rename would then fail against it — leaving every event
  // either of them ever added stranded in a table nothing reads.
  //
  // A rename rather than a copy: SQLite carries the rows, the column types and
  // the indexes across, and there is no window where the data exists in neither
  // place. Only fires when the old name is there and the new one isn't, so
  // running it twice does nothing.
  if (tableExists(db, "household_events") && !tableExists(db, "dorm_events")) {
    db.exec("ALTER TABLE household_events RENAME TO dorm_events");
    // The index came across under its old name and would otherwise sit beside
    // the one the schema creates, indexing the same column twice.
    db.exec("DROP INDEX IF EXISTS household_events_starts_idx");
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
    -- belongs to the dorm rather than to one of us.
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

      -- Whose this one calendar is, when that differs from whose the account
      -- is. One Apple ID holds both "Joao" and a shared "Dorm", and only the
      -- second is the flat's. Two columns because there are three answers and
      -- a nullable id can only carry two: owner_set = 0 means "same as the
      -- account", and owner_set = 1 with a null owner_person_id means the
      -- dorm. Everything downstream keys off the resulting person being
      -- null, so an override reaches colours, labels and notifications at once.
      owner_set       INTEGER NOT NULL DEFAULT 0,
      owner_person_id INTEGER REFERENCES people(id) ON DELETE SET NULL,

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
    -- how dorm stuff gets onto the calendar.
    CREATE TABLE IF NOT EXISTS dorm_events (
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
    CREATE INDEX IF NOT EXISTS dorm_events_starts_idx
      ON dorm_events(starts_at);

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
      created_at TEXT NOT NULL DEFAULT (datetime('now')),

      -- 'need' (groceries and the like) or 'want' (a tracked purchase).
      -- The two are priced by completely different means: a need remembers
      -- what you last paid, a want is looked up from a retailer.
      category   TEXT NOT NULL DEFAULT 'need',

      -- Needs: the last price typed in when the item was ticked off.
      last_price_cents INTEGER,
      last_price_at    TEXT,

      -- Wants: the product this is bound to at a retailer. retailer_query is
      -- what to search for until a sku is found; once bound, the sku is used.
      retailer            TEXT,
      retailer_query      TEXT,
      retailer_sku        TEXT,
      retailer_url        TEXT,
      retailer_name       TEXT,
      price_cents         INTEGER,
      regular_price_cents INTEGER,
      price_checked_at    TEXT,
      price_error         TEXT,
      -- Where price_cents came from: 'manual' if a person typed it, otherwise
      -- the retailer. Worth a column of its own so the app never claims to
      -- have checked a price it was simply told.
      price_source        TEXT
    );

    -- Every price ever seen, from either method. Enough to say "cheaper than
    -- last time" without keeping a second copy of the current price.
    CREATE TABLE IF NOT EXISTS price_history (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id     INTEGER NOT NULL REFERENCES list_items(id) ON DELETE CASCADE,
      price_cents INTEGER NOT NULL,
      source      TEXT NOT NULL,  -- 'manual' | retailer name
      recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS price_history_item_idx
      ON price_history(item_id, recorded_at DESC);

    -- What a thing costs, remembered by name rather than by row.
    --
    -- A shopping list is meant to be emptied: you buy the paper towels, tick
    -- them off, clear the cart. If the price lived only on the row it would
    -- die with it, and "last time $4.29" would never once appear — the memory
    -- has to outlive the item to be worth having.
    CREATE TABLE IF NOT EXISTS price_memory (
      name        TEXT PRIMARY KEY,   -- normalised: lowercased, spaces collapsed
      label       TEXT NOT NULL,      -- as last typed, for display
      price_cents INTEGER NOT NULL,
      recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- One row per phone that has agreed to be notified.
    --
    -- Keyed by endpoint because that's what the browser gives us and what
    -- identifies the device to the push service; the same phone re-subscribing
    -- gets the same endpoint back, so ON CONFLICT keeps it to one row.
    --
    -- person_id is asked for when notifications are turned on, and is the only
    -- way to send a chore reminder to the person whose turn it actually is —
    -- there's one shared passcode, so the app otherwise has no idea whose
    -- phone it's talking to.
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      person_id   INTEGER REFERENCES people(id) ON DELETE SET NULL,
      endpoint    TEXT NOT NULL UNIQUE,
      p256dh      TEXT NOT NULL,
      auth        TEXT NOT NULL,
      label       TEXT,              -- 'iPhone', for telling two devices apart
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      last_sent_at TEXT,
      last_error  TEXT,
      failures    INTEGER NOT NULL DEFAULT 0
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
  const dormColumns = columnsOf(db, "dorm_events");
  for (const [name, type] of [
    ["caldav_calendar_id", "INTEGER"],
    ["caldav_url", "TEXT"],
    ["caldav_uid", "TEXT"],
    ["caldav_etag", "TEXT"],
  ] as const) {
    if (dormColumns.includes(name)) continue;
    try {
      db.exec(`ALTER TABLE dorm_events ADD COLUMN ${name} ${type}`);
    } catch (err) {
      if (!/duplicate column name/i.test(String(err))) throw err;
    }
  }

  // The shopping list gained Wants and Needs, and the price columns each of
  // them is tracked by. Same idempotent add as above.
  const listColumns = columnsOf(db, "list_items");
  for (const [name, type] of [
    ["category", "TEXT NOT NULL DEFAULT 'need'"],
    ["last_price_cents", "INTEGER"],
    ["last_price_at", "TEXT"],
    ["retailer", "TEXT"],
    ["retailer_query", "TEXT"],
    ["retailer_sku", "TEXT"],
    ["retailer_url", "TEXT"],
    ["retailer_name", "TEXT"],
    ["price_cents", "INTEGER"],
    ["regular_price_cents", "INTEGER"],
    ["price_checked_at", "TEXT"],
    ["price_error", "TEXT"],
    ["price_source", "TEXT"],
  ] as const) {
    if (listColumns.includes(name)) continue;
    try {
      db.exec(`ALTER TABLE list_items ADD COLUMN ${name} ${type}`);
    } catch (err) {
      if (!/duplicate column name/i.test(String(err))) throw err;
    }
  }

  // A calendar can now be the dorm's even when its account is someone's.
  // The added owner_person_id carries no REFERENCES clause — SQLite can't add
  // a foreign key to an existing table — but a dangling id joins to no row and
  // so reads as the dorm, which is what ON DELETE SET NULL would give.
  const calendarColumns = columnsOf(db, "caldav_calendars");
  for (const [name, type] of [
    ["owner_set", "INTEGER NOT NULL DEFAULT 0"],
    ["owner_person_id", "INTEGER"],
  ] as const) {
    if (calendarColumns.includes(name)) continue;
    try {
      db.exec(`ALTER TABLE caldav_calendars ADD COLUMN ${name} ${type}`);
    } catch (err) {
      if (!/duplicate column name/i.test(String(err))) throw err;
    }
  }

  seedFirstWant(db);
  applyRequestedColors(db);
  claimSharedCalendars(db);
}

/**
 * Calendars named after the flat belong to the flat.
 *
 * The dorm's shared calendar is called "Dorm" and it sat inside one
 * person's Apple ID, so everything on it — the rent, the landlord, the things
 * both of them need telling about — read as that person's and was left out of
 * the dorm reminders, which go to whatever has nobody's name on it.
 *
 * Names are the only signal available: a calendar's URL says nothing about what
 * it's for. So this matches on the name once, the same way the requested colours
 * are applied once, and then never again — the pickers in Setup are the real
 * answer, and a choice made there must not be undone by the next boot.
 */
function claimSharedCalendars(db: Database.Database) {
  const marker = "shared_calendars_claimed";
  const done = db
    .prepare<[string], { value: string }>(
      "SELECT value FROM settings WHERE key = ?",
    )
    .get(marker);
  if (done) return;

  for (const row of db
    .prepare<[], { id: number; display_name: string }>(
      "SELECT id, display_name FROM caldav_calendars",
    )
    .all()) {
    if (!looksLikeSharedCalendar(row.display_name)) continue;
    db.prepare(
      `UPDATE caldav_calendars
       SET owner_set = 1, owner_person_id = NULL WHERE id = ?`,
    ).run(row.id);
  }

  for (const row of db
    .prepare<[], { id: number; label: string }>("SELECT id, label FROM feeds")
    .all()) {
    if (!looksLikeSharedCalendar(row.label)) continue;
    db.prepare("UPDATE feeds SET person_id = NULL WHERE id = ?").run(row.id);
  }

  db.prepare("INSERT INTO settings (key, value) VALUES (?, '1')").run(marker);
}

/**
 * The dorm asked for particular colours — red for Nino, blue for João —
 * rather than the ones the palette handed out when they signed up. Names are
 * the only stable way to tell who is who; ids just record who was typed in
 * first.
 *
 * Runs once and leaves a marker, so colours changed in Setup afterwards are
 * never overwritten. A name that matches nothing is left alone.
 */
/**
 * The first Want, added once.
 *
 * No SKU here on purpose. Best Buy's catalogue is the authority on which
 * product this is, so the item is stored as a search and the first price
 * check binds whatever it finds — which also means it can't be wrong about a
 * model number I guessed at.
 */
function seedFirstWant(db: Database.Database) {
  const marker = "seeded_first_want";
  const done = db
    .prepare<[string], { value: string }>(
      "SELECT value FROM settings WHERE key = ?",
    )
    .get(marker);
  if (done) return;

  db.prepare(
    `INSERT INTO list_items (text, category, retailer, retailer_query)
     VALUES (?, 'want', 'bestbuy', ?)`,
  ).run('LG 48" OLED evo B5', 'LG 48 class B5 series OLED evo 4K smart TV');

  db.prepare("INSERT INTO settings (key, value) VALUES (?, '1')").run(marker);
}

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
 * touch the dorm's data.
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
