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

**Chromium alone is not enough for layout.** Both phones here run Safari, and
it has already disagreed with Chrome twice, both times inside the week grid's
horizontal scroller: **Safari resolves intrinsic widths there against the
scrollport, not the content.** A box sized by `w-max` or by `flex: 1` came out
356px against Chrome's 856, so anything painted across one — an overlay of
hour lines, a row's background, the pinned header's underline — stopped a
third of the way through the week. State the width instead
(`style={{ minWidth: … }}`) and paint per column rather than across all of
them. Everything measured perfectly in Chromium while the calendar was
visibly broken on the owner's phone. Playwright's WebKit is the same engine Safari
uses — `npx playwright install webkit && npx playwright install-deps webkit`,
then drive it with the `devices['iPhone 13']` profile. It won't keep the
session cookie over plain http (the cookie is `secure` in production), so log
in with Chromium and copy the cookies across with `secure: false`.

Shopping prices are testable the same way: `BESTBUY_API_BASE` points the Best
Buy client at a stand-in, so the whole path — search, bind a SKU, refresh,
notice a change — runs for real without a key. Test the no-key state too; it
is the state the app is actually deployed in.

`src/lib/layout.ts` (event placement) is a pure function and is worth testing
directly rather than through the UI.

## Where things stand

Working and deployed: merged calendars, two-way iCloud sync, day/week/month/
year views with an event detail dialog, chores with rotation, shopping list,
home-screen install with live refresh, and a per-event destination calendar on
the add form.

**Picking the calendar per event.** The add form carries a `calendar_id`
select, built from `getWritableCalendars()` and pre-selected with the
`write_calendar_id` setting that Setup still writes. `addHouseholdEvent`
resolves it through `getWritableCalendar()`, so a read-only or deleted
calendar is refused rather than written to; a submission with no field at all
falls back to the Setup default. With no CalDAV account the select isn't
rendered and events stay local. Deletion needed no change — each row already
records the calendar it went to.

**Adding from the calendar.** Double-clicking (or double-tapping) empty grid
opens the same add form in a dialog, with the day and the time pointed at
already filled in — quarter-hour rounded, see `timeAt` in `time-grid.tsx`.
Touch screens don't fire a reliable `dblclick`, so taps are paired by hand
from `pointerup`; mouse double-clicks use `onDoubleClick`. The same form also
sits under the grid as a disclosure, as on the Today page.

**Colours.** `src/lib/colors.ts` is the one place they live: the apartment is
gold, and each person keeps their own. Nino red and João blue were applied
once by `applyRequestedColors` in `db.ts`, which leaves a `settings` marker so
anything changed in Setup afterwards sticks. `textOn()` picks black or white
ink per background — white on gold is unreadable. What colour an iCloud
account's events take comes from the person it's assigned to, changeable per
account in Setup (`setAccountPerson`); unassigned accounts read as the
apartment.

**Chores on the calendar.** `getChoreEvents()` in `data.ts` turns the rotation
into all-day entries in the apartment colour, projected forward by each
chore's cadence with the assignee projected alongside — so you can see whose
turn the bins are in a fortnight. They are *derived on read*, never stored: a
chore's due date moves every time someone marks it done, so a written copy
would be wrong within a week and the calendar could disagree with the Chores
tab. `getEvents()` takes `{ includeChores }`, on only for the calendar page —
the Today screen already lists what's due in its own section, and one screen
showing each chore twice helps nobody. They aren't pushed to iCloud; doing
that would mean reconciling remote events on every completion.

The headers and the all-day row pin to the top of the grid as one band. They
used to be separate, so opening on the morning hours scrolled an all-day event
out of sight — which for a chore, whose only presence on the grid is that row,
meant it may as well not have been there.

**The week grid.** Overlapping events divide their day evenly — two abreast
take half each, three a third (`placeEvents`). The week used to carry a blank
spacer after Sunday so every column could snap; the last column now snaps to
the scrollport's end instead, so the grid stops where the week does.

**Shopping list: Wants and Needs.** Two categories, priced by different
means because groceries and televisions are different problems.

*Needs* (method 1) remember what you paid: type the price when you tick an
item off, and it shows "last time $4.29" next time, with a trip estimate and a
monthly total. No API — nothing covers Aldi or Martin's, and a price from a
shop you're not standing in is worse than none.

The remembered price lives in `price_memory`, keyed by a normalised item name,
**not** on the item row. It has to: a shopping list is meant to be emptied, and
when the price lived on the row it died with it, so "last time $4.29" could
never appear in normal use. Keyed by name means it also survives deleting the
item and comes back when it's re-added, case and punctuation ignored.

Items can be deleted permanently one at a time (`deleteListItem`) as well as in
bulk per category. Deleting removes the item, never the price memory —
forgetting the item isn't the same as forgetting what it costs.

*Wants* (method 2) are looked up from Best Buy's Products API
(`src/lib/bestbuy.ts`, `src/lib/prices.ts`). A Want is stored as a *search*
until the first check binds it to a SKU; after that it refreshes by SKU so the
price can't drift onto a different product. `price_history` records only
actual movement, which is what powers "↓ $100 since last check". Refreshes
piggyback on the calendar sync, six-hour staleness.

Needs `BESTBUY_API_KEY` (free, developer.bestbuy.com). Without it the Wants
list still works and says plainly why there's no price, rather than showing a
stale number as though it were current — there is a test for exactly that.
`BESTBUY_API_BASE` overrides the host so the price path can be tested against
a stand-in. The first Want, the LG 48" B5 OLED, is seeded once in `db.ts` with
no SKU on purpose: Best Buy's catalogue decides which product it is.

## Worth a decision

**Four-way overlaps are unreadable again.** Splitting a column evenly means
four overlapping events get a quarter of 116px each — 27px, narrower than a
character, so those blocks show no text. That directly conflicts with the
owner's instruction that "the title and time for the events should always be
apparent on the calendar". The cascade this replaced kept every block at least
52% wide but never reached the right edge. Neither is free; the owner should
pick. Two or three abreast are fine either way.

## Next task

**Forms lose what was typed when an action returns an error.**

React 19 resets uncontrolled fields once a form action completes, error or
not, so a rejected submission clears the title, the notes, the feed URL, and
so on. `ActionForm` in `src/components/forms.tsx` already resets deliberately
on success (`resetOnSuccess`), which suggests the reset on failure was never
intended. The add-event form now avoids the worst of it by marking the start
time `required` so the browser catches it before submitting, but the general
case is still there: any server-side validation error empties the form.

Worth fixing in `ActionForm` — keep the submitted `FormData` and write the
values back when the action reports an error.
