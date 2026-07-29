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

**`npm test`.** 33 unit tests over the four things whose bugs are invisible
until they're embarrassing: the date and timezone maths (`tests/dates.test.ts`),
recurring event expansion (`ics`), reading a price out of a page (`prices`), and
where blocks go in the calendar grid (`layout`). They run in about a second, need
no browser and no server, and **`.github/workflows/deploy.yml` will not deploy
if they fail**.

Two flags in the test script earn their place:

- `--experimental-strip-types` runs the TypeScript directly, so there's no build
  step and no second toolchain to keep in sync.
- `--conditions=react-server` makes `import "server-only"` resolve to the
  variant that doesn't throw. Without it, anything importing a server-only
  module can't be unit tested at all.

Anything with a database, a browser or a network call is still tested the way
everything here has been: by driving the built app in Chromium with Playwright,
against a local Radicale CalDAV server standing in for iCloud, a stub shop, and
a stub push service. **Those scripts are not in the repo** and are the obvious
next thing to commit — port them into `tests/e2e/` with `@playwright/test` and
add them to the workflow. That approach has caught real bugs repeatedly (a broken
migration, silently dropped server actions, clipped calendar text, an event that
came back from the dead) — prefer it over reasoning about whether something
works.

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
is the state the app is actually deployed in, and it is the state hand-typed
Want prices exist for. The handover is worth testing as one run: type a price
with no key, restart with the stand-in, check, and confirm the typed figure is
replaced while its history survives.

**Two things were tested and turned out not to need fixing.** Both had been
written up here as risks; the tests are the record that they aren't:

- **Recurring events are handled correctly**, including a weekly repeat crossing
  the November DST change (it keeps its local 7am rather than its UTC instant),
  a single deleted occurrence via EXDATE, a single moved one via RECURRENCE-ID,
  and an all-day monthly repeat. So `rrule` / `ical-expander` would buy nothing.
  Don't swap `node-ical` out without a failing test in hand first.
- **`wallClockToUtc` is correct**, including the 2:30am on 8 March that doesn't
  exist and the 1:30am on 1 November that happens twice. It's hand-rolled with
  two correction passes and looks alarming, which is why it now has nine tests
  pinning it. Replacing it with Temporal would be a refactor with no behavioural
  gain, and would cost either a Node 26 bump or a polyfill dependency. It lives
  in `dates.ts` (moved there from `actions.ts`, since that's where the rule says
  date maths goes).

**Push is testable end to end without a phone.** A subscription endpoint is
just a URL, so `push-service-stub.js` stands in for Apple's push service and the
real send path runs for real — VAPID signing, aes128gcm encryption, 410 pruning,
per-person routing. Two things to know: the stub must be **HTTPS** (web-push
will not downgrade), so it uses a self-signed cert and the app runs with
`NODE_TLS_REJECT_UNAUTHORIZED=0` for that test only; and the fake subscription
needs a real P-256 key pair, or encryption fails before anything is sent.

**Check both sides of a write.** For anything that changes an event, assert
against the CalDAV server with an independent `tsdav` client *and* against what
the app shows. An edit that looks right in the app can be a create-plus-orphan
on the server, and a delete that looks right on the server can still be showing
in the app from the stale mirror. Both of those were real, and only the
two-sided check caught them.

## Where things stand

Working and deployed: merged calendars, two-way iCloud sync, day/week/month/
year views with an event detail dialog, chores with rotation, shopping list with
Needs and Wants, per-item price sources, editing for events/chores/list items,
per-item ownership, a refresh button on every page, home-screen install with live
refresh, and web push notifications.

**Two things are waiting on the owner, not on code:**

1. `BESTBUY_API_KEY` is still unset on Fly, so Best Buy lookups do nothing. The
   .edu application is blocked while he's in Brazil (their verification wants a
   US location); the plan is to retry from campus in August. Link-priced and
   hand-typed Wants work regardless.
2. Chore reminders are only as reliable as whatever pokes the app. Nothing
   schedules `/api/refresh` yet. A free cron service hitting it each morning with
   the `AGENDA_CRON_SECRET` bearer token is all it needs — worth offering, since
   `AGENDA_CRON_SECRET` isn't set either.

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

**Editing.** Events, chores and list items can all be changed after the fact.
Three different UIs for three different shapes of thing, and each one reuses
the form that creates it rather than growing a second copy:

- *Events* — `updateHouseholdEvent`. The detail dialog gains an **Edit** button
  that swaps its body for `EventFields` in edit mode; `readEventForm` and
  `readCalendarChoice` are shared with `addHouseholdEvent`, so the validation
  can't drift. Only household events qualify — `CalEvent.edit` is built on the
  server (the date and times have to be worked out in the household timezone)
  and is null for feed events and chores. It's also null on every day of a
  multi-day event except the first, or editing from the third day would move it.
  `EventRow` on Today links to `/calendar?view=day&date=…&edit=<id>`, which
  `CalendarView` reads **once, on mount** — reading it on every render would
  re-open the dialog every 45 seconds when `LiveRefresh` fires.
- *Chores* — `updateChore`, in a `<details>` under each row. `rotation_index`
  is deliberately untouched: renaming a chore doesn't mean the person who did
  it last should go again.
- *List items* — `updateListItem`, revealed by `?edit=<id>` so the page stays
  server-rendered and the app's own refresh can't close the form mid-typing.
  Renaming a Need re-reads `price_memory` under the new name (fixing a typo
  should find the real price). Retargeting a Want clears its bound SKU and
  re-searches — otherwise the new wording would change nothing.

**Whose an item is.** `list_items.added_by` — a person id, or null for the
apartment — set by `OwnerSelect` on both the add form and the edit form, and
read by `readOwner()`, which maps the literal `'household'` (and anything it
can't parse) to null. Null is now the *default* on the add form; it used to be
`people[0].id`, which meant everything Nino added without touching the picker
came out labelled João. An unlabelled item on a shared list belongs to the
flat, and being wrong about whose protein powder it is costs more than being
vague. `OwnerTag` renders the apartment in `HOUSEHOLD_COLOR` rather than
rendering nothing, so choosing "Apartment" doesn't look like a save that
failed.

Moving an event between iCloud calendars is a create in the new one and a
delete from the old, in that order: a failed create then leaves the original
alone, where a failed create *after* a delete would lose the event entirely. If
the delete fails the edit still saves and the user is told there's a copy left
behind, because only they can clear it.

**A deleted event could come back.** `events` is a mirror of what the last sync
saw, and a sync only rebuilds a calendar when that calendar is pulled. Removing
an event from iCloud therefore left a stale mirror row behind — and with the
`household_events` row that used to suppress it gone (or moved to a new UID),
nothing hid it any more and it reappeared as though it were an ordinary feed
event. `forgetCachedEvent(uid)` corrects the mirror at the point of deletion,
in both `removeHouseholdEvent` and the move path. This was found by the
Radicale test, not by reading the code.

**Notifications** (`src/lib/push.ts`, `public/sw.js`, `src/components/push-setup.tsx`).
Web push with VAPID via the `web-push` package. Keys are generated on first use
and kept in `settings`, unencrypted on purpose: the private key is only useful
alongside the subscription endpoints, which are in the same database, so
encrypting one of the two would be theatre. Losing them costs a re-subscribe per
phone, nothing more.

**The service worker is the exception to this project's own rule, and it must
stay narrow.** `public/sw.js` handles `push` and `notificationclick` and has
**no `fetch` handler**. That is the whole reason a deploy still reaches both
phones immediately — a worker that answers fetches serves its cache first, which
is how installed web apps get stuck three versions back. There is a test
asserting the absence of a fetch handler and of any cache use; if it ever fails,
somebody has traded away the thing that makes this app trustworthy. Fix the
code, not the test.

**Who a notification goes to.** There is one shared passcode, so the session
says "somebody who lives here" and nothing more. Two separate mechanisms fill
the gap: `push_subscriptions.person_id`, asked for when notifications are turned
on, routes a chore reminder to whoever's turn it is; and an `agenda_device_person`
cookie set at the same moment lets `addListItem` tell "your roommate added
something" from "you added something". Without the cookie the list notification
is skipped rather than guessed at — buzzing you about your own shopping is worse
than silence.

What fires: a chore due today (once per chore per day, marked in `settings`),
**the apartment calendar's events for today** (both phones), **an apartment event
added / moved / cancelled** (the other phone), a price drop of $5 or more (never
a rise), and a list addition.

**"The apartment's" events** are the ones with nobody's name on them:
`personName === null` in `getEvents`, which covers both `household_events` and
any iCloud calendar Setup leaves unassigned — the shared "Dorm" calendar. A
personal event is never announced to the flat, and there is a test for exactly
that (two events due today, only one announced, so two sends rather than four).

**The reminder marker is keyed by what the event *is*, not by its row id** — a
sha1 of summary + start + all-day. Feed rows live in the `events` cache, which is
deleted and rebuilt on every sync, so their ids change underneath us; keying on
one would re-announce the same event after each refresh. Chore reminders
run from `notifyChoresDueInBackground()` on the Today and Chores pages **and**
from `/api/refresh`. The honest limitation is in that first path: opening the app
is the moment you'd have seen the chore anyway, so a scheduler pointed at
`/api/refresh` each morning is what makes it useful.

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

**Wants are priced three ways** (`list_items.retailer`): `'bestbuy'` through
the API, `'link'` by reading the page at `retailer_url`, or `NULL` for by hand.
Pasting a URL into the add box picks `'link'` on its own and renames the item
from the page — a raw URL is a terrible name for a wish list. `src/lib/scrape.ts`
reads JSON-LD first, then Open Graph, then Amazon's own markup.

**What actually works, measured rather than assumed.** One request each to
twelve real shops, with the same parser the app uses:

| Result | Shops |
| --- | --- |
| Blocked outright (403/503) | Best Buy web, B&H, Micro Center, Adorama, Home Depot, Etsy, REI, Newegg (bot wall behind a 200) |
| Real page, no structured data | Amazon, Walmart, Target, IKEA |
| Read correctly via JSON-LD | Ridge, Peak Design — i.e. the Shopify-shaped long tail |

So the generic reader earns its place on smaller shops and is useless on
megastores. Amazon is the exception worth special-casing and got one
(`fromAmazon`): it serves the real page to a plain request, so the price comes
out of `corePrice_feature_div`. **That is a promise about someone else's HTML
and will break.** When it does the item says it couldn't find a price, which is
the same thing any unreadable page says — never a number from the wrong element.

**Fetching a URL a user typed is an SSRF sink**, and this one runs on Fly where
169.254.169.254 is a real thing. `assertPublic()` resolves the hostname and
refuses private, loopback, link-local, CGNAT and multicast addresses, and
redirects are followed by hand so every hop is checked too. Ten cases are
covered in `ssrf-e2e.js`; run it against a server with **no** `AGENDA_SCRAPE_BASE`,
since that override deliberately rewrites every host and would mask the guard.

**A Want's price can also be typed in** (`setWantPrice`), which is what makes
the list useful before a key exists — and the key may be a while: Best Buy no
longer issues them to free email addresses, and the owner's .edu application is
blocked because their verification asks for a US location while he's in Brazil.
A typed price goes through the same row and the same `price_history`, so the
up/down arrows work identically, and a later API check simply overwrites the
current price with the history intact behind it.

`list_items.price_source` is what keeps that honest: `'manual'` when a person
typed the figure, the retailer otherwise. The Wants list reads it to say "you
entered this 2d ago" instead of "checked 2d ago" — a number nobody checked must
never be able to pass for a fresh lookup. `getSpentThisMonth` excludes Wants
for the same reason: a price you observed on a television is not money spent on
groceries.

## Where things stand, as of the last session

Working and deployed: everything above. In rough order of how recently it
landed — link-and-Amazon pricing for Wants, per-item owner tags, editing for
events/chores/list items, the refresh button in every page header, hand-typed
Want prices, and notifications.

**Waiting on the owner, not on code:**

- `BESTBUY_API_KEY` is still unset in Fly secrets. Best Buy stopped issuing keys
  to free email addresses, and the .edu route is blocked while he's in Brazil —
  their verification wants a US location. Retrying from campus in August is the
  plan. Nothing is broken meanwhile: Wants take a link or a typed price.
- A scheduler pointed at `/api/refresh` each morning. Without one, chore
  reminders only fire when somebody opens the app, which is the moment they'd
  have seen the chore anyway. Any free cron service with the `AGENDA_CRON_SECRET`
  bearer token does it; that secret is also currently unset.
- The overlap decision below.

**Ideas raised and not built** (the owner picked notifications from this list):
who-owes-whom from the prices and owner tags already recorded; Google Calendar
as a second source for his `@nd.edu` class schedule; weather on the Today
screen; Notre Dame's academic calendar as a feed if they publish one.

**Ideas already discussed with the owner and not built.** He asked what would
make the app better and picked notifications first; these were the rest, in the
order they were ranked:

- **Who owes whom.** The pieces are already there — `price_history` knows what
  things cost, `list_items.added_by` knows whose they were — so a monthly split
  is arithmetic on data the app holds, with nothing new to sign up for. This is
  the obvious next feature.
- **Google Calendar as a second source**, for his `@nd.edu` class schedule. Notre
  Dame runs on Google. Free but needs an OAuth client registered, which is the
  one step he'd have to do himself.
- **Weather on Today** (Open-Meteo, free, no key) and **Notre Dame's academic
  calendar** if they publish an `.ics`.

He also asked about building this in Lovable. Answered no for this repo: Lovable
starts projects rather than adopting them, and its shape (Vite SPA + Supabase) has
nowhere to put the CalDAV sync or the SQLite file. Suggested using it as a design
sketchpad and bringing screenshots back here.

## Worth a decision

Nothing outstanding. The four-way-overlap question that sat here is settled:
`layout.ts` caps at `MAX_COLUMNS = 3` and puts the rest behind an overflow chip,
so every drawn block keeps at least a third of the column — enough for text,
which is what the owner actually asked for. `tests/layout.test.ts` asserts both
halves, including that a hidden fourth event doesn't shift the visible three.

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
