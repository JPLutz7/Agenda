# Handoff

Context for anyone (or any session) picking this up cold.

## What this is

A shared calendar for two roommates at Notre Dame, Indiana. It merges their
iCloud calendars into one view and adds the shared things a calendar can't
do — rotating chores, a shopping list, and a dorm calendar both can write to.

**The one word for the shared thing is "the dorm."** It used to be "the
apartment" in the interface and "household" in the code, which meant two names
for one idea; both are gone, including the `dorm_events` table. The only place
either old word survives is `SHARED_CALENDAR_WORDS` in `colors.ts`, where they
are names an iCloud calendar might have, not this app's vocabulary.

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
  the user typed lives there — that's `dorm_events`, `chores`,
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

**`npm test`.** 66 unit tests over the things whose bugs are invisible until
they're embarrassing: the date and timezone maths (`tests/dates.test.ts`),
recurring event expansion (`ics`), reading a price out of a page and telling a
shop's refusal from a product with no price (`prices`),
where blocks go in the calendar grid (`layout`), the VAPID contact address
Apple refuses (`contact`), which calendar names read as the dorm's
(`shared-calendar`), the Today headline and its countdowns (`headline`), and
the shopping list's sort orders (`list-sort`). They run in about a second, need
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
came back from the dead, a test button that deleted itself) — prefer it over
reasoning about whether something works.

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

**A stub that accepts anything proves nothing.** The first version of that stub
answered 201 to every request, so the suite confirmed the push was well-formed
without confirming a real service would take it — and the app shipped
identifying itself as `mailto:agenda@localhost`, which Apple answers with 403
BadJwtToken and no delivery. Every check passed, both phones registered, nothing
ever arrived. The stub now decodes the VAPID token and refuses a bad subject the
way Apple does, and the rule itself is pinned by `tests/contact.test.ts`, which
needs no browser and runs in CI. **When standing in for somebody else's service,
copy its refusals, not just its successes.**

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
`write_calendar_id` setting that Setup still writes. `addDormEvent`
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

- *Events* — `updateDormEvent`. The detail dialog gains an **Edit** button
  that swaps its body for `EventFields` in edit mode; `readEventForm` and
  `readCalendarChoice` are shared with `addDormEvent`, so the validation
  can't drift. Only dorm events qualify — `CalEvent.edit` is built on the
  server (the date and times have to be worked out in the dorm timezone)
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
dorm — set by `OwnerSelect` on both the add form and the edit form, and
read by `readOwner()`, which maps the literal `'dorm'` (and anything it
can't parse) to null. Null is now the *default* on the add form; it used to be
`people[0].id`, which meant everything Nino added without touching the picker
came out labelled João. An unlabelled item on a shared list belongs to the
flat, and being wrong about whose protein powder it is costs more than being
vague. `OwnerTag` renders the dorm in `DORM_COLOR` rather than
rendering nothing, so choosing "Dorm" doesn't look like a save that
failed.

Moving an event between iCloud calendars is a create in the new one and a
delete from the old, in that order: a failed create then leaves the original
alone, where a failed create *after* a delete would lose the event entirely. If
the delete fails the edit still saves and the user is told there's a copy left
behind, because only they can clear it.

**A deleted event could come back.** `events` is a mirror of what the last sync
saw, and a sync only rebuilds a calendar when that calendar is pulled. Removing
an event from iCloud therefore left a stale mirror row behind — and with the
`dorm_events` row that used to suppress it gone (or moved to a new UID),
nothing hid it any more and it reappeared as though it were an ordinary feed
event. `forgetCachedEvent(uid)` corrects the mirror at the point of deletion,
in both `removeDormEvent` and the move path. This was found by the
Radicale test, not by reading the code.

**Notifications** (`src/lib/push.ts`, `public/sw.js`, `src/components/push-setup.tsx`).
Web push with VAPID via the `web-push` package. Keys are generated on first use
and kept in `settings`, unencrypted on purpose: the private key is only useful
alongside the subscription endpoints, which are in the same database, so
encrypting one of the two would be theatre. Losing them costs a re-subscribe per
phone, nothing more.

**Whose an event is, and why it's a per-calendar question.** Ownership decides
three things at once: the colour, the label, and whether a notification goes to
both phones or neither — dorm reminders are simply "events with no person
attached". A published feed's owner is `feeds.person_id`. A CalDAV calendar's
comes from `caldav_calendars.owner_set` / `owner_person_id`, falling back to the
account's person when `owner_set` is 0. That override exists because one Apple ID
holds several calendars and they aren't all one person's: the dorm's shared
"Dorm" sits in Joao's account and is the flat's. `looksLikeSharedCalendar` in
`colors.ts` makes such a calendar the flat's the first time it's seen — on insert
in `sync.ts` and `connectICloudAccount`, plus a marked one-off pass in `db.ts` for
calendars discovered before that existed. All three leave a later choice in Setup
alone; if a sync ever starts overwriting ownership, that's the bug.

**`AGENDA_PUBLIC_URL` is load-bearing** (`src/lib/contact.ts`). It's the VAPID
subject — "who to contact about this push traffic" — and Apple refuses anything
that isn't a real https address or a real email address, delivering nothing while
both phones still show as registered. `fly.toml` sets it to
`https://agenda-nd.fly.dev`; the same value is the default in code, so a fresh
deploy works either way. Change it if the app moves. When a send fails, the
reason is written to `push_subscriptions.last_error` and shown on that device's
row in Setup, and "Send a test" says which of the four things happened — nothing
registered, the phone had revoked and was dropped, the service refused it and
why, or it worked. Reported, never thrown: an exception in a server action is a
blank error page.

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
**the dorm calendar's events for today** (both phones), **a dorm event
added / moved / cancelled** (the other phone), a price drop of $5 or more (never
a rise), and a list addition.

**"The dorm's" events** are the ones with nobody's name on them:
`personName === null` in `getEvents`, which covers both `dorm_events` and
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

**How it looks.** Four rules, all in `globals.css` and `ui.tsx`:

- **Outfit for headings only** — bundled in `public/fonts` (SIL OFL, licence
  beside it) rather than fetched from Google at build time, so a font CDN outage
  can't fail a deploy and nothing the app serves phones home. Body text stays on
  the system font, which is what people read fastest.
- **Calendar blocks are tinted, not filled** (`tintedBlock` in `ui.tsx`). Solid
  fills were legible but turned a busy week into a wall of paint and forced the
  title into reversed-out white. A `color-mix` tint plus a solid left edge keeps
  the title the darkest thing in the block and works in both schemes off one
  `--tint-strength` token. `textOn()` in `colors.ts` is now unused by the
  calendar — it's still right, just no longer needed there.
- **`SubmitButton` owns its own sizes** (`md` / `sm` / `icon`). Every caller used
  to pass its own padding, which is how Done, Check, Got it and Save ended up
  four different heights side by side. Don't pass padding classes to it.
- **No text characters standing in for icons.** ✕ ✎ ✓ ↑ ↓ were all glyphs, and
  the pencil rendered as a coloured emoji on some platforms while everything
  around it was grey — the single thing that most made the app look homemade.
  They're lucide components now.

**The design brief, and where it came from.** The owner named the apps he
wanted this to feel like — Sam Ruston's (Weather Timeline, Flamingo, BuzzKill,
Bouncer, Luci), then a gallery at laudableapps.com and a Medium list. Reading
those pages as text was useless; what worked was downloading the screenshots
and looking at them. Three things came out of that and are now load-bearing:

- **Lead with the answer.** Every screen opens with one large sentence — "Two
  things today, first at 6pm" — built by `buildHeadline` in `src/lib/headline.ts`,
  not with a title and a list. It's set at the size those apps actually use
  (measured off the screenshots, not guessed).
- **Per-row countdowns, the way Flighty does them.** `countdownTo` shows "in
  3h 20m" beside a row inside a twelve-hour horizon (`COUNTDOWN_HORIZON_MINUTES`)
  and nothing outside it — a countdown to something nine days away is noise.
- **Colour, but only where it means something.** The app was too monochrome;
  the fix was owner colour on the things that belong to somebody (`OwnerTile`,
  `ownerWash`, `tintedBlock` in `ui.tsx`), not decoration everywhere. `OwnerTile`
  is `role="img"` with the owner's full name as its `aria-label` — it was
  `aria-hidden` at first, which silently deleted whose-is-it from a screen
  reader. The same tile is used on List and in Setup so the two agree.

One reversal worth remembering: a floating drop shadow was added to the panels
because it felt more "designed", and the reference screenshots then showed flat
panels with a hairline border. It came back out in the same sitting. **When
there's a reference, look at it before deciding.**

**Light and dark, and anything else this phone remembers** (`src/lib/prefs.ts`).
Per-device preferences live in cookies, read on the server and written into the
HTML, so the first paint is already right — the usual client-side script flashes
the wrong colours for a frame on every page load. Two of them so far: the colour
scheme (`agenda_theme`, Auto/Light/Dark, and Auto is the *absence* of the cookie)
and the shopping list's sort (`agenda_list_sort`). Cookies rather than the
database because both roommates share one login: anything stored centrally would
mean one of them turning on dark mode turns it on for the other. Nothing here is
trusted — the worst a forged value can do is show you your own screen wrong.

Both pickers are the same shape: one `<form>` per option posting to a server
action (`chooseTheme`, `chooseListSort`), `aria-pressed` on the chosen one, no
client-side JavaScript. The list sort was in the URL first, and that was wrong
in a way worth stating: the tab bar and every notification link to a plain
`/list`, so the choice reset on every arrival. A control you re-choose each
visit is one you stop using.

**Scrolling the calendar on a phone.** The week grid scrolls sideways and the
hours scroll down, and the two used to fight: a thumb dragging down the hours
would drift a column sideways and change the day. The fix that worked is
`touch-action: pan-y` on the hour area — the browser refuses the horizontal
gesture there outright — plus one column per gesture in the wheel handler for
trackpads. Two earlier attempts failed and are worth not repeating: damping the
sideways delta does nothing while `scroll-snap-type: x mandatory` is on (the
snap re-runs after every programmatic scroll), and a ratio-based wheel test with
no absolute floor gets *easier* to pass as momentum decays. Also: **synthetic
DOM touch events do not scroll anything.** Real touch testing here means CDP
`Input.dispatchTouchEvent`. Two rounds of this were spent tuning the mouse wheel
before the owner said "I was always talking about the phone" — on a screen with
no mouse, tune the touch path first.

**Colours.** `src/lib/colors.ts` is the one place they live: the dorm is
gold, and each person keeps their own. Nino red and João blue were applied
once by `applyRequestedColors` in `db.ts`, which leaves a `settings` marker so
anything changed in Setup afterwards sticks. `textOn()` picks black or white
ink per background — white on gold is unreadable. What colour an iCloud
account's events take comes from the person it's assigned to, changeable per
account in Setup (`setAccountPerson`); unassigned accounts read as the
dorm.

**Chores on the calendar.** `getChoreEvents()` in `data.ts` turns the rotation
into all-day entries in the dorm colour, projected forward by each
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

**A link is kept whatever prices the item.** Best Buy blocks page reads, so a
pasted Best Buy URL binds to the API by SKU (`bestBuySku` in `scrape.ts`) and
the item is named from the address (`bestBuyNameFromUrl`, which drops the
structural path segments and un-shouts acronyms). `retailer_url` is stored
either way, so the row still offers "View at Best Buy" and switching an item to
a hand-typed price no longer throws the link away — the link is how you get back
to the product, which has nothing to do with where the number came from.

**Sorting the list** (`src/lib/list-sort.ts`, pure and unit-tested). Three
orders: as added, by price, by whose it is. Nulls sink in every order, the
dorm's own items come first when sorting by owner, and ordering is stable
within a group so a re-sort doesn't shuffle equals. `priceOf` reads a Want's
current price and a Need's remembered one — the two live in different columns
and sorting the Wants tab by a Need's column would have been silently wrong.
Each tab sorts its own items, and the "done" half is sorted too. The picker is
hidden below two items; offering to reorder one thing makes an app feel like a
form.

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

**Re-measured when the owner hit "couldn't find a price" on an Amazon link.**
Five live product pages: three priced correctly, and the two that didn't were
marked *currently unavailable* in Amazon's buy box — there was no price on
those pages for anyone. So `fromAmazon` still works, and the report was the app
being honest rather than broken. Two things came out of checking it:

- **Never fall back to the first `a-offscreen` price on an Amazon page.** It is
  tempting — an unavailable product's page is still full of `$` spans — and it
  is wrong: those belong to the *recommendation carousel*, i.e. other products
  (`pd_rd_i=` carries a different ASIN). This was nearly shipped as a "fix" for
  a parser that wasn't broken. `amazonOutOfStock` is scoped to `apex_desktop`
  for the same reason: "currently unavailable" appears all over a page whose
  product is in stock.
- **A refusal can wear a 200.** Amazon's *search* URLs answer a plain request
  with an Akamai JavaScript interstitial (`bm-verify`,
  `triggerInterstitialChallenge`) rather than a 403, so the old code read the
  challenge page, found no price, and blamed the product. `looksLikeBotChallenge`
  now catches that and it reports as `BlockedByShop`. It matches challenge
  markers in the first 4KB only, and deliberately not the bare word "captcha" —
  a false positive there tells you a working shop has blocked you.

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
landed — telling a shop's refusal apart from a product with no price, the three
fixes the bug sweep turned up (whose-it-is on ticked items, a chore's tile in
that person's colour, the Best Buy key notice said once), a remembered per-phone
sort on the shopping list, sorting by price or owner, keeping a product link
whatever prices the item, the colour pass and the owner tiles, per-row
countdowns and the headline, light/dark, the phone-scroll fixes, the "dorm"
rename, and the notification fix.

**The whole app was swept in a browser on 31 July and found functionally
sound** — see "The bug sweep, and what it found" below for what was checked,
what it cleared and what it fixed. A next sweep should start from that list
rather than repeat it: the areas touched since are the Amazon reader's three
new outcomes, and anything a sweep can only see on a real phone.

**Waiting on the owner, not on code:**

- `BESTBUY_API_KEY` is still unset in Fly secrets. Best Buy stopped issuing keys
  to free email addresses, and the .edu route is blocked while he's in Brazil —
  their verification wants a US location. Retrying from campus in August is the
  plan. Nothing is broken meanwhile: Wants take a link or a typed price.
- **Re-enabling notifications on both phones** and tapping "Send a test". The
  VAPID subject was wrong for a while, which means the devices registered under
  it were being refused; the fix shipped but neither phone has confirmed a
  delivery since.
- A scheduler pointed at `/api/refresh` each morning. Without one, chore
  reminders only fire when somebody opens the app, which is the moment they'd
  have seen the chore anyway. Any free cron service with the `AGENDA_CRON_SECRET`
  bearer token does it; that secret is also currently unset.

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

## The bug sweep, and what it found

**Done.** One pass over the whole app in a browser at iPhone 13 size, in both
Chromium and WebKit, driving every screen and every action rather than reading
the code: add / edit / delete for events, chores and list items; all four
calendar views; both list tabs; light, dark and auto; tab switches and reloads;
real touch gestures via CDP.

**Nothing was functionally broken.** That is the headline and it is worth
stating plainly, because three of the recent changes were suspected and all
three came back clean:

- **The rename is complete.** No user-facing "apartment" or "household"
  survives. Every remaining hit is a code comment, the `household_events`
  migration, or `SHARED_CALENDAR_WORDS` and its test, all deliberate.
- **Safari agrees with Chrome in the week grid.** The intrinsic-width trap has
  not come back: both engines measure the scroller at 856px of content in a
  356px port, and the screenshots are interchangeable. Measured, not assumed.
- **The phone-scroll fix holds under real touch.** A slow drag on the date row
  moves exactly one column per gesture (0 → 116 → 232 → 348 → clamped end); a
  vertical drag in the hour area, even one pulling 60px sideways, moves the
  horizontal scroll by exactly zero. `touch-action: pan-y` is doing its job.

What it did find were three places where screens disagreed with each other —
the cost of verifying each change on its own. All three are fixed:

- A **ticked-off list item lost its owner tile**, in the cart and in bought
  alike, so the same thing was Nino's on one line and nobody's on the next —
  and "sort by whose", which sorts the done half too, was reordering rows with
  nothing on screen to explain the order.
- A **chore's tile on the calendar** wore the right initial in the *dorm's*
  gold, while the same chore on Today and Chores wore that person's own
  colour. Hence `ownerColor` on `AgendaEvent`: the tile answers "whose turn",
  the block's tint answers "whose thing it is", and for a chore those are
  different answers. The block on the grid is still gold.
- The **missing-Best-Buy-key explanation repeated in red under every item**
  that had been checked once — four copies of one sentence on a screen whose
  amber bar already said it, and absent under items nobody had checked, so the
  list disagreed with itself. The bar says it once now.

Two smaller things were looked at and deliberately left alone, both because
they turned out to be intentional and documented in the code: the per-row
countdown *replaces* the clock time rather than sitting beside it, and a list
item's edit form stays open after saving (it shows `Saved "…"`, the same
pattern the event dialog uses).

**A trap for the next session, which cost time here.** `lsof` does not see
listening sockets in this container, so "is the old server still up?" cannot be
answered that way — a stale server will keep serving the previous build while
`npm start` fails with EADDRINUSE somewhere you aren't looking, and you will
conclude your fix didn't work. Start each run on a **fresh port** and confirm
from that run's own log before believing anything the browser shows you. Two
findings were chased against a stale server before this was spotted.

## Next task

**The e2e suites into the repo.** They still live in a scratchpad that dies
with the session, which means every session re-derives them and CI never runs
any of them. This sweep re-derived them again: a login helper, an HTTPS
front-end (the session cookie is `secure`, so plain http drops it and the
sign-in silently fails), seeding through the UI, and CDP touch gestures.
Porting that into `tests/e2e/` with `@playwright/test` and adding a job to the
workflow is the highest-value work left that isn't a feature.

Note for whoever does it: `/opt/pw-browsers` ships a WebKit build older than
the `playwright` npm package expects, so `npx playwright install webkit` is
needed once before WebKit will launch.

After that, the feature the owner ranked first: **who owes whom**, a monthly
split from `price_history` and `list_items.added_by` — arithmetic on data the
app already holds, with nothing new to sign up for.

*(The previous entry here — forms losing what was typed when an action returns
an error — is done. `restoreValues` in `src/components/forms.tsx` writes the
submitted `FormData` back on failure.)*
