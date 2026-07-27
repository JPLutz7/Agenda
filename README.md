# Agenda

A shared calendar for an apartment. It pulls in everyone's published iCloud
calendars, merges them into one view, and adds the household things a calendar
app can't do — chores that rotate, a shopping list, and an apartment calendar
you both write to.

Built for two people sharing a place. It works with more, but it isn't trying
to be a product.

## What it does

- **One merged calendar.** Everyone's iCloud events, colour-coded by person, in
  a day agenda and a week view.
- **An apartment calendar.** Things that belong to the flat rather than to one
  person — landlord visits, rent, a party — added in the app.
- **Chores that rotate.** Set a chore and a cadence. Marking it done passes the
  turn to the other person and records who did it last.
- **A shopping list.** Anyone adds, anyone ticks off.

## Running it

```bash
npm install
npm run dev          # http://localhost:3000
```

The first page asks for both names and a household passcode. There are no user
accounts — one passcode, shared between the people who live there.

Data goes in `./data/agenda.db` (SQLite). Set `AGENDA_DB_PATH` to move it.

## Connecting a calendar

iCloud has no API, but it will publish a calendar as a read-only `.ics` feed,
which is what this reads.

1. **On a Mac:** Calendar → right-click the calendar → *Share Calendar*.
   **On iPhone:** Calendars → the ⓘ next to the calendar.
2. Turn on **Public Calendar**.
3. Copy the `webcal://` link and paste it into **Setup → Connect a calendar**.

Repeat for each calendar. Feeds refresh when someone opens the app and the data
is more than ten minutes old.

### Two things to know before you publish

- **A published iCloud calendar is readable by anyone with the link.** It's a
  long random URL, not a password. That's fine for an apartment calendar; think
  about it before publishing a personal one. To share only some events, make a
  second calendar in iCloud and publish that instead.
- **It's read-only, in both directions.** This app can't change anything in
  iCloud, and events added here don't appear in your phone's Calendar app. That
  isn't a bug — it's the limit of what a published feed allows.

## Configuration

| Variable | Default | What it's for |
| --- | --- | --- |
| `AGENDA_DB_PATH` | `./data/agenda.db` | Where the SQLite file lives. |
| `AGENDA_SECRET` | generated, stored in the DB | Signs session cookies. Set it in production so sessions survive a database reset. |
| `AGENDA_CRON_SECRET` | unset | Enables `GET /api/refresh` for an external scheduler. |

Set the household timezone in **Setup**. Every day boundary and chore due date
is worked out in it.

### Keeping feeds warm

Optional — the app already refreshes itself whenever someone opens it.

```bash
curl -H "Authorization: Bearer $AGENDA_CRON_SECRET" https://your-host/api/refresh
```

## Deploying

Any host that runs a Node process and gives you a persistent disk. The one hard
requirement: **the SQLite file must survive redeploys.** On a platform with an
ephemeral filesystem, the household's data resets every time you push.

```bash
docker build -t agenda .
docker run -p 3000:3000 -v agenda-data:/data \
  -e AGENDA_SECRET=$(openssl rand -hex 32) agenda
```

On iPhone, open it in Safari and *Add to Home Screen* — it runs full-screen
like an app, with no App Store involved.

## How it's put together

- **Next.js App Router**, server components, server actions for every mutation.
- **SQLite** via `better-sqlite3`. One file, no database server.
- **`node-ical`** for parsing feeds. Recurring events are expanded 14 days back
  and 180 days forward into an `events` table that is purely a cache — a sync
  deletes and rebuilds one feed's rows inside a transaction, so a failed fetch
  never destroys anything you typed.

The one part worth knowing if you touch the code: all-day events are stored as
bare date strings (`2026-07-04`), timed events as UTC instants. All-day events
deliberately never become timestamps — that's how "July 4th" ends up displaying
as July 3rd for half the world. See `src/lib/dates.ts`.

## Where to take it next

- **Two-way sync via CalDAV.** iCloud speaks CalDAV at `caldav.icloud.com` with
  an app-specific password, which would let the app write to your real
  calendars. Workable for a household, but it means storing each person's
  app-specific password — a real trade-off rather than a free upgrade.
- **Shared expenses.** Nothing is built; the schema has room for it.
- **Push notifications** for a chore coming due, via web push.
