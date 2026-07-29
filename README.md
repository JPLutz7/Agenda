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
- **Notifications.** A chore on the day it's yours, what's on the apartment
  calendar today, a price drop worth knowing about, and anything your roommate
  adds to the list or puts on the apartment calendar.
- **A shopping list.** Anyone adds, anyone ticks off. Each thing on it belongs
  to the apartment or to one person, colour-coded the same way the calendar is,
  and that can be changed later — the washing-up liquid is everyone's, the
  protein powder isn't.

Things you're saving up for (the **Wants** tab) get their prices three ways:
Best Buy's API, reading the page at a link you paste, or typed in by hand. Each
item picks its own and says which — a price that was looked up an hour ago and
one you typed in March are not the same claim, so the app never words them the
same way.

Everything the app owns can be changed after the fact — tap an event and
**Edit**, or use the pencil beside a chore or a list item. Events that came
from an iCloud feed belong to whoever published them, and a chore's dates
belong to its rotation, so those two say where to change them instead of
offering an edit that wouldn't stick.

## Running it

```bash
npm install
npm run dev          # http://localhost:3000
```

The first page asks for both names and a household passcode. There are no user
accounts — one passcode, shared between the people who live there.

Data goes in `./data/agenda.db` (SQLite). Set `AGENDA_DB_PATH` to move it.

## Connecting a calendar

Two ways, and they are not equivalent.

### Connecting the account (two-way, recommended)

iCloud speaks **CalDAV** — the protocol the Calendar app itself uses. Connect
the account and events created in Agenda are written into your real iCloud
calendar, so they appear on both phones in the normal Calendar app. Deleting
one here deletes it there.

1. Go to **appleid.apple.com** → Sign-In and Security → *App-Specific
   Passwords*, and generate one.
2. In **Setup → Connect an iCloud account**, enter your Apple ID and that
   password.
3. Pick which calendars to show, and which one new events should be written to.

Your normal Apple ID password will not work while two-factor authentication is
on — it has to be an app-specific one.

**About the credentials.** An app-specific password is not a scoped token; it
grants access to that Apple ID's calendar data. It's encrypted at rest with
AES-256-GCM using a key derived from `AGENDA_SECRET`, which lives in the
environment and never in the database — so a copy of the database file alone is
not enough to read it. `AGENDA_SECRET` must be set before an account can be
connected. You can revoke the password from that same Apple page at any time,
which disconnects Agenda without affecting your account.

### Publishing a link (read-only, simpler)

iCloud will also publish a calendar as a read-only `.ics` feed, which needs no
credentials. Nothing you add in Agenda can reach your real calendar this way.

1. **On a Mac:** Calendar → right-click the calendar → *Share Calendar*.
   **On iPhone:** Calendars → the ⓘ next to the calendar.
2. Turn on **Public Calendar**.
3. Copy the `webcal://` link and paste it into **Setup → Connect a calendar**.

Repeat for each calendar. Feeds refresh when someone opens the app and the data
is more than ten minutes old.

Two things to know before you publish one:

- **A published iCloud calendar is readable by anyone with the link.** It's a
  long random URL, not a password. That's fine for an apartment calendar; think
  about it before publishing a personal one. To share only some events, make a
  second calendar in iCloud and publish that instead.
- **It's read-only, in both directions.** Events added in Agenda don't appear
  in your phone's Calendar app. That isn't a bug — it's the limit of what a
  published feed allows. Connect the account instead if you want write-back.

## Configuration

| Variable | Default | What it's for |
| --- | --- | --- |
| `AGENDA_DB_PATH` | `./data/agenda.db` | Where the SQLite file lives. |
| `AGENDA_SECRET` | generated, stored in the DB | Signs session cookies, and derives the key that encrypts iCloud passwords. **Required** before an iCloud account can be connected. |
| `AGENDA_CALDAV_URL` | `https://caldav.icloud.com` | The CalDAV server to connect to. Change it for Fastmail or a self-hosted server. |
| `AGENDA_CRON_SECRET` | unset | Enables `GET /api/refresh` for an external scheduler. |
| `BESTBUY_API_KEY` | unset | Free key from developer.bestbuy.com. Enables Best Buy lookups on the Wants list. Link-priced and hand-typed items work without it. |
| `BESTBUY_API_BASE` | `https://api.bestbuy.com/v1` | Overrides the API host, for testing against a stand-in. |
| `AGENDA_SCRAPE_BASE` | unset | Rewrites the host of every product link before fetching, so the price-reading path can be tested against a local page. **Testing only** — it also exempts that host from the private-address check. |

Set the household timezone in **Setup**. Every day boundary and chore due date
is worked out in it.

### Notifications

Turn them on per phone in **Setup → Notifications**. On iPhone the app must be
added to the Home Screen first — iOS grants push only to installed web apps,
and the panel says so rather than failing mysteriously.

You're asked whose phone it is, because there's one shared passcode: it's the
only way a chore reminder can reach whoever's turn it actually is, and the only
way "your roommate added this" can avoid being sent to the roommate who added it.

What arrives:

- **Chores due today**, to whoever's turn it is. Once per chore per day.
- **The apartment calendar's events for today**, to both phones. "The
  apartment's" means anything with nobody's name on it — added in this app, or
  in an iCloud calendar Setup leaves unassigned. Personal events are never
  announced to the flat.
- **Apartment events added, moved or cancelled**, to whoever didn't do it.
- **A price drop of $5 or more** on the Wants list. Never a rise.
- **Anything added to the shopping list**, to the other person.

The day's reminders go out shortly after 8:00 household time, from the server's
own background loop — no external scheduler needed. The loop ticks every ten
minutes and only sends between 8:00 and 21:00: without a floor a restart just
after midnight would buzz about a day that has barely started, and without a
ceiling a late-evening deploy would fire the whole day's reminders on the way up,
when nothing can be done about the bins anyway.

Nothing to configure and no keys to obtain — the app generates its own signing
keys on first use and keeps them in the database.

### Keeping feeds warm

Entirely optional. The server has its own background loop that syncs calendars
and sends the day's reminders, so nothing external is required. This endpoint
does the same work for anyone who'd rather drive it from outside.

```bash
curl -H "Authorization: Bearer $AGENDA_CRON_SECRET" https://your-host/api/refresh
```

## Deploying

**See [DEPLOY.md](DEPLOY.md)** for step-by-step instructions. The short version:
any host that runs a Node process and gives you a persistent disk, running
**exactly one instance**. Two instances means two SQLite files and two versions
of the truth. Serverless hosts like Vercel won't work — the filesystem resets
and the data goes with it.

```bash
docker build -t agenda .
docker run -p 3000:3000 -v agenda-data:/data \
  -e AGENDA_SECRET=$(openssl rand -hex 32) agenda
```

On iPhone, open it in Safari and *Add to Home Screen* — it runs full-screen
like an app, with no App Store involved.

## Staying up to date

Once it's sitting on a home screen it needs to behave like an app that knows
things have changed. Three separate mechanisms, because there are three
separate ways a phone web app goes stale:

- **Someone else made a change.** Every screen re-fetches from the server every
  45 seconds while it's open, so a chore your roommate ticks off shows up on
  your phone without you touching anything. Polling stops while the app is in
  the background.
- **You reopened the app.** iOS freezes a backgrounded home-screen app and
  hands back the pixels you left behind, which is how these apps end up showing
  yesterday's agenda with nothing on screen admitting it. The app refreshes on
  foreground, on window focus, on coming back online, and on Safari's
  back/forward cache restore.
- **The code changed.** Pages are served `no-store`, and the one service worker
  in the project (`public/sw.js`) **has no `fetch` handler** — that's the
  deliberate part. A service worker that answers fetches serves its own cache
  first and needs a correct update dance to ever let go of it, which is the
  usual reason an installed web app gets stuck on a version from three deploys
  ago. With nothing intercepting requests there is nothing to serve stale: a
  deploy reaches both phones the next time either of you opens the app, with
  nothing to invalidate and no "clear your cache" conversation. That file exists
  only because notifications are impossible without it.

A refresh will not fire while you're typing in a field — otherwise the form
would re-render out from under the keyboard mid-word. It catches up as soon as
the field loses focus.

There's also a refresh button in the top right of every page. It's not the same
as the automatic refresh: that one only re-pulls iCloud if the last pull was
more than ten minutes ago, whereas the button pulls immediately. An installed
home-screen app has no browser reload of its own, and "I just added it on my
phone, where is it" deserves an answer better than waiting.

The cost of skipping the service worker is that the app needs a connection; it
won't open on the subway. That's the right trade for something whose entire job
is telling you what's true right now.

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
