# Handoff

Context for anyone (or any session) picking this up cold.

## What this is

A shared calendar for two roommates at Notre Dame, Indiana. It merges their
iCloud calendars into one view and adds the household things a calendar can't
do — rotating chores, a shared shopping list, and an apartment calendar both
can write to.

- **Repo:** `JPLutz7/Agenda`, branch `claude/shared-roommate-calendar-0x23o9`
  (this is the repository's default branch).
- **Live at:** `https://agenda-nd.fly.dev` — Fly.io app `agenda-nd`, one
  always-on machine in `ord` (Chicago), volume `agenda_data` at `/data`.
- **Deploys:** pushing to the branch triggers `.github/workflows/deploy.yml`,
  which runs `flyctl deploy` on GitHub's runners. The owner has no dev
  environment — they were working from a locked-down work computer — so
  **everything ships by pushing**, never by asking them to run commands.

## Who you're talking to

The owner does not write code. Explain in plain language, avoid jargon, and
don't send them to a terminal. They shouldn't have to run, build, or verify
anything — do that here and push.

## Architecture, briefly

Next.js App Router, server components, server actions for every mutation.
SQLite via `better-sqlite3`. See `README.md` for the full picture and
`DEPLOY.md` for hosting.

Things that will bite you if you don't know them:

- **All-day events are bare date strings** (`2026-07-04`); timed events are
  ISO UTC. All-day values must never become timestamps. See `src/lib/dates.ts`.
- **`src/lib/db.ts` opens the database lazily**, on first query rather than on
  import. Importing it eagerly makes `next build` create and migrate a database
  as a side effect, which fails intermittently under parallel build workers.
- **`npm start` runs `scripts/start.mjs`, not `next start`.** With
  `output: standalone`, `next start` boots and serves pages but silently drops
  every server action.
- **The `events` table is a cache** rebuilt per source on each sync. Nothing
  the user typed lives there — that's `household_events`, `chores`,
  `list_items`.

## How calendars work

Two ways in, and they are not equivalent:

1. **CalDAV (two-way).** Apple ID + app-specific password, stored
   AES-256-GCM-encrypted (`src/lib/secrets.ts`) with a key derived from
   `AGENDA_SECRET` in the environment, never from the database. Events created
   in the app are written to iCloud and appear in the real Calendar app.
2. **Published `.ics` feed (read-only).** No credentials, but nothing written
   in the app can reach the real calendar.

`AGENDA_SECRET` must never be rotated — it would orphan the stored iCloud
credentials.

## Testing

There is no test runner in the repo. Verification has been done by driving the
built app in Chromium with Playwright, and against a local Radicale CalDAV
server standing in for iCloud. That approach has caught real bugs repeatedly
(a broken migration, silently dropped server actions, clipped calendar text) —
prefer it over reasoning about whether something works.

```
PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers   # chromium is preinstalled
executablePath: '/opt/pw-browsers/chromium'
AGENDA_CALDAV_URL=http://127.0.0.1:5232     # point CalDAV at a test server
```

`src/lib/layout.ts` (event placement) is a pure function and is worth testing
directly rather than through the UI.

## Where things stand

Working and deployed: merged calendars, two-way iCloud sync, day/week/month/
year views with an event detail dialog, chores with rotation, shopping list,
home-screen install with live refresh.

## Next task

**Choose the calendar per event, instead of only globally.**

Today a single calendar receives everything the app creates. It's chosen in
Setup → *Where new events go* and stored as the `write_calendar_id` setting.

The goal: pick the destination calendar **each time you add an event**, with
the Setup choice becoming the pre-selected default rather than the only option.

Relevant code:

| What | Where |
| --- | --- |
| Add-event form (client component) | `src/components/add-event-form.tsx` |
| Rendered on the home page | `src/app/page.tsx` |
| The action that creates events | `addHouseholdEvent` in `src/lib/actions.ts` |
| Resolves the single target today | `getWriteCalendar()` in `src/lib/data.ts` |
| Lists accounts and their calendars | `getCalDavAccounts()` in `src/lib/data.ts` |
| Setup UI with the current selector | `src/components/icloud-setup.tsx` |

Notes for whoever does it:

- `household_events` already has a `caldav_calendar_id` column, so an event
  can record which calendar it went to. `removeHouseholdEvent` already reads it
  to delete remotely, so per-event destinations should work for deletion
  without change — worth confirming.
- Calendars marked `read_only` must not be offered.
- A household may have no CalDAV account at all (feeds only, or nothing yet).
  The picker should degrade to "this app only" rather than appearing broken.
- The existing `write_calendar_id` setting should keep working as the default;
  don't drop it.
