/**
 * Recurring events, which are the least visible and most fragile part of the
 * calendar. `expandIcs` is a pure function, so this needs no browser and no
 * server — which is exactly why it's worth having.
 *
 * The cases here are the four that go wrong in real calendar apps: a repeat
 * crossing a daylight-saving boundary, a single deleted occurrence, a single
 * moved one, and an all-day repeat drifting by a day.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { expandIcs } from "../src/lib/ics.ts";
import { formatTime, eventDayKey } from "../src/lib/dates.ts";

const TZ = "America/Indiana/Indianapolis";
const wrap = (...events: string[]) =>
  [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Test//EN",
    ...events,
    "END:VCALENDAR",
  ].join("\r\n");

/** A window wide enough to contain the autumn daylight-saving change. */
const FROM = new Date("2026-10-15T00:00:00Z");
const TO = new Date("2026-11-20T00:00:00Z");

const days = (list: { startsAt: string; allDay: boolean }[]) =>
  list.map((o) => eventDayKey(o.startsAt, o.allDay, TZ)).sort();

test("a weekly repeat keeps its local time across the DST change", () => {
  // 7am Tuesdays. US clocks go back on 1 November 2026, so occurrences either
  // side of it are 11:00Z and 12:00Z — the same 7am to the person going.
  const out = expandIcs(
    wrap(
      "BEGIN:VEVENT",
      "UID:gym",
      "DTSTAMP:20260101T000000Z",
      `DTSTART;TZID=${TZ}:20261020T070000`,
      `DTEND;TZID=${TZ}:20261020T080000`,
      "RRULE:FREQ=WEEKLY;BYDAY=TU",
      "SUMMARY:Gym",
      "END:VEVENT",
    ),
    FROM,
    TO,
  );

  assert.ok(out.length >= 4, `expected several occurrences, got ${out.length}`);
  const times = [...new Set(out.map((o) => formatTime(o.startsAt, TZ)))];
  assert.deepEqual(
    times,
    ["7 AM"],
    `every occurrence should read 7 AM locally, got ${times.join(", ")}`,
  );

  // And the ones after the change really are a different UTC instant, which is
  // what proves the local time was preserved rather than the UTC one.
  const before = out.find((o) => o.startsAt < "2026-11-01");
  const after = out.find((o) => o.startsAt > "2026-11-02");
  assert.ok(before && after, "need occurrences either side of the change");
  assert.notEqual(
    before!.startsAt.slice(11, 16),
    after!.startsAt.slice(11, 16),
    "UTC time should shift by an hour across the DST boundary",
  );
});

test("EXDATE removes exactly one occurrence", () => {
  const without = expandIcs(
    wrap(
      "BEGIN:VEVENT",
      "UID:standup",
      "DTSTAMP:20260101T000000Z",
      `DTSTART;TZID=${TZ}:20261020T090000`,
      `DTEND;TZID=${TZ}:20261020T093000`,
      "RRULE:FREQ=WEEKLY;BYDAY=TU",
      `EXDATE;TZID=${TZ}:20261027T090000`,
      "SUMMARY:Standup",
      "END:VEVENT",
    ),
    FROM,
    TO,
  );
  const keys = days(without);
  assert.ok(keys.includes("2026-10-20"), "the first one should survive");
  assert.ok(
    !keys.includes("2026-10-27"),
    `the excluded date should be gone, got ${keys.join(" ")}`,
  );
  assert.ok(keys.includes("2026-11-03"), "later ones should survive");
});

test("a single moved occurrence moves, and doesn't also appear at its old time", () => {
  const out = expandIcs(
    wrap(
      "BEGIN:VEVENT",
      "UID:advising",
      "DTSTAMP:20260101T000000Z",
      `DTSTART;TZID=${TZ}:20261020T140000`,
      `DTEND;TZID=${TZ}:20261020T150000`,
      "RRULE:FREQ=WEEKLY;BYDAY=TU",
      "SUMMARY:Advising",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:advising",
      "DTSTAMP:20260101T000000Z",
      `RECURRENCE-ID;TZID=${TZ}:20261027T140000`,
      `DTSTART;TZID=${TZ}:20261028T160000`,
      `DTEND;TZID=${TZ}:20261028T170000`,
      "SUMMARY:Advising (moved)",
      "END:VEVENT",
    ),
    FROM,
    TO,
  );
  const keys = days(out);
  assert.ok(
    keys.includes("2026-10-28"),
    `the moved occurrence should land on the 28th, got ${keys.join(" ")}`,
  );
  assert.equal(
    keys.filter((k) => k === "2026-10-27").length,
    0,
    "and must not still show on the 27th",
  );
});

test("an all-day repeat lands on its own day, not the day before", () => {
  const out = expandIcs(
    wrap(
      "BEGIN:VEVENT",
      "UID:rent",
      "DTSTAMP:20260101T000000Z",
      "DTSTART;VALUE=DATE:20261101",
      "DTEND;VALUE=DATE:20261102",
      "RRULE:FREQ=MONTHLY;BYMONTHDAY=1",
      "SUMMARY:Rent due",
      "END:VEVENT",
    ),
    FROM,
    TO,
  );
  assert.ok(out.length >= 1, "should produce at least November");
  for (const occurrence of out) {
    assert.equal(occurrence.allDay, true);
    assert.match(occurrence.startsAt, /^\d{4}-\d{2}-01$/);
    assert.equal(
      eventDayKey(occurrence.startsAt, true, TZ),
      occurrence.startsAt,
      "an all-day date must never shift when read back in the household zone",
    );
  }
});

test("a cancelled event is dropped entirely", () => {
  const out = expandIcs(
    wrap(
      "BEGIN:VEVENT",
      "UID:off",
      "DTSTAMP:20260101T000000Z",
      `DTSTART;TZID=${TZ}:20261021T100000`,
      `DTEND;TZID=${TZ}:20261021T110000`,
      "STATUS:CANCELLED",
      "SUMMARY:Called off",
      "END:VEVENT",
    ),
    FROM,
    TO,
  );
  assert.deepEqual(out, []);
});
