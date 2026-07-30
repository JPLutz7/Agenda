/**
 * The date and timezone maths, which is where this app's worst bugs would live
 * if it had any.
 *
 * Two rules the whole app depends on, stated here as tests so they can't quietly
 * stop being true:
 *
 * 1. An all-day value is a bare date string and must never become a timestamp.
 *    That conversion is how "July 4th" ends up displaying as July 3rd.
 * 2. A wall-clock time typed by a person means that time *in the dorm's
 *    zone*, on the day in question, daylight saving included.
 *
 * The daylight-saving dates used below are the real ones for 2026 in US
 * Eastern, which is what Indiana/Indianapolis observes: clocks go forward on
 * 8 March and back on 1 November.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addDays,
  daysBetween,
  eventDayKey,
  formatTime,
  minutesIntoDay,
  startOfWeek,
  toDayKey,
  wallClockToUtc,
  weekdayOf,
} from "../src/lib/dates.ts";

const TZ = "America/Indiana/Indianapolis";

test("a wall-clock time becomes the right instant in summer and winter", () => {
  // Eastern is UTC-4 on daylight time, UTC-5 on standard time.
  assert.equal(wallClockToUtc("2026-07-04", "14:00", TZ), "2026-07-04T18:00:00.000Z");
  assert.equal(wallClockToUtc("2026-12-04", "14:00", TZ), "2026-12-04T19:00:00.000Z");
});

test("and reads back as the same wall clock it was given", () => {
  for (const [date, time] of [
    ["2026-07-04", "14:00"],
    ["2026-12-04", "14:00"],
    ["2026-03-07", "23:30"],   // the night before the clocks go forward
    ["2026-03-09", "00:30"],   // the night after
    ["2026-10-31", "23:30"],   // before they go back
    ["2026-11-02", "00:30"],   // after
    ["2026-01-01", "00:00"],   // midnight, which is its own trap
  ] as const) {
    const instant = wallClockToUtc(date, time, TZ);
    assert.equal(
      eventDayKey(instant, false, TZ),
      date,
      `${date} ${time} landed on the wrong day`,
    );
    const minutes = minutesIntoDay(instant, TZ);
    const [h, m] = time.split(":").map(Number);
    assert.equal(
      minutes,
      h * 60 + m,
      `${date} ${time} came back as ${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`,
    );
  }
});

test("the hour that does not exist still produces a real instant on the right day", () => {
  // 2:30am on 8 March 2026 never happens — the clocks jump 2am to 3am. There is
  // no correct answer, but there is a wrong one: a different day, or NaN.
  const instant = wallClockToUtc("2026-03-08", "02:30", TZ);
  assert.match(instant, /^2026-03-08T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.equal(eventDayKey(instant, false, TZ), "2026-03-08");
});

test("the hour that happens twice picks one and stays on the right day", () => {
  // 1:30am on 1 November 2026 happens twice. Either is defensible; drifting to
  // the 31st of October is not.
  const instant = wallClockToUtc("2026-11-01", "01:30", TZ);
  assert.equal(eventDayKey(instant, false, TZ), "2026-11-01");
  assert.equal(minutesIntoDay(instant, TZ), 90);
});

test("an all-day date is never shifted by the zone it is read in", () => {
  for (const day of ["2026-07-04", "2026-01-01", "2026-12-31", "2026-03-08"]) {
    assert.equal(eventDayKey(day, true, TZ), day);
    assert.equal(eventDayKey(day, true, "Pacific/Kiritimati"), day);
    assert.equal(eventDayKey(day, true, "Pacific/Midway"), day);
  }
});

test("adding days crosses the DST boundary without gaining or losing one", () => {
  assert.equal(addDays("2026-03-07", 1), "2026-03-08");
  assert.equal(addDays("2026-03-08", 1), "2026-03-09");
  assert.equal(addDays("2026-10-31", 2), "2026-11-02");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2026-01-01", -1), "2025-12-31");
  assert.equal(daysBetween("2026-03-01", "2026-03-31"), 30);
  assert.equal(daysBetween("2026-10-25", "2026-11-08"), 14);
});

test("a week starts on Sunday, including across a DST change", () => {
  assert.equal(startOfWeek("2026-11-04"), "2026-11-01");
  assert.equal(startOfWeek("2026-03-11"), "2026-03-08");
  assert.equal(weekdayOf("2026-11-01"), 0);
  assert.equal(weekdayOf("2026-11-07"), 6);
});

test("toDayKey uses the zone it is handed, not the server's", () => {
  // 03:00Z on 5 July is still the evening of 4 July in Indiana.
  const instant = new Date("2026-07-05T03:00:00Z");
  assert.equal(toDayKey(instant, TZ), "2026-07-04");
  assert.equal(toDayKey(instant, "UTC"), "2026-07-05");
});

test("times are formatted the way a person reads them", () => {
  assert.equal(formatTime(wallClockToUtc("2026-07-04", "09:00", TZ), TZ), "9 AM");
  assert.equal(formatTime(wallClockToUtc("2026-07-04", "14:30", TZ), TZ), "2:30 PM");
  assert.equal(formatTime(wallClockToUtc("2026-07-04", "00:00", TZ), TZ), "12 AM");
  assert.equal(formatTime(wallClockToUtc("2026-07-04", "12:00", TZ), TZ), "12 PM");
});
