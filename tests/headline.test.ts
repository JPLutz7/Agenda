/**
 * The line at the top of Today.
 *
 * It's the first thing read and the easiest thing to get subtly wrong: telling
 * you what's next while you're in the middle of something, saying "in 1 hours",
 * or claiming a free day when three chores are overdue. All phrasing, no
 * database — so it's cheap to pin all of it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildHeadline, relativeTime } from "../src/lib/headline.ts";

const TZ = "America/Indiana/Indianapolis";
const DORM = "#d4a017";
// 2026-07-30, 14:00 in Indiana (UTC-4 in summer).
const NOW = "2026-07-30T18:00:00.000Z";

const at = (hourUtc: number, minute = 0) =>
  `2026-07-30T${String(hourUtc).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00.000Z`;

const event = (summary: string, start: string, end: string, allDay = false) => ({
  summary,
  startsAt: start,
  endsAt: end,
  allDay,
  color: "#2563eb",
});

const build = (events: ReturnType<typeof event>[], chores: { title: string; overdue: boolean }[] = []) =>
  buildHeadline({ events, chores, nowIso: NOW, timeZone: TZ, dormColor: DORM });

test("something happening right now beats something starting soon", () => {
  const h = build([
    event("Lecture", at(17, 30), at(19)),
    event("Landlord inspection", at(20, 30), at(21, 30)),
  ]);
  assert.equal(h.kind, "now");
  assert.equal(h.title, "Lecture");
  assert.equal(h.detail, "until 3 PM");
});

test("otherwise it's the next thing, with how long you've got", () => {
  const h = build([event("Landlord inspection", at(18, 40), at(19, 40))]);
  assert.equal(h.kind, "next");
  assert.equal(h.title, "Landlord inspection");
  assert.equal(h.detail, "in 40 minutes · 2:40 PM");
});

test("an event that has finished is not the next thing", () => {
  const h = build([event("Breakfast", at(12), at(13))]);
  assert.equal(h.kind, "clear");
});

test("an all-day entry leads when there's no clock time left", () => {
  const h = build([
    event("Breakfast", at(12), at(13)),
    event("Rent is due", "2026-07-30", "2026-07-31", true),
  ]);
  assert.equal(h.kind, "allday");
  assert.equal(h.title, "Rent is due");
  assert.equal(h.detail, "");
});

test("and says how many others there are", () => {
  const h = build([
    event("Rent is due", "2026-07-30", "2026-07-31", true),
    event("Bin day", "2026-07-30", "2026-07-31", true),
  ]);
  assert.equal(h.detail, "and 1 other");

  const three = build([
    event("Rent is due", "2026-07-30", "2026-07-31", true),
    event("Bin day", "2026-07-30", "2026-07-31", true),
    event("Fire drill", "2026-07-30", "2026-07-31", true),
  ]);
  assert.equal(three.detail, "and 2 others");
});

test("with nothing on the calendar it falls back to the chores", () => {
  const one = build([], [{ title: "Take the bins out", overdue: false }]);
  assert.equal(one.kind, "chores");
  assert.equal(one.title, "Take the bins out");
  assert.equal(one.detail, "");

  const many = build([], [
    { title: "Take the bins out", overdue: true },
    { title: "Hoover", overdue: true },
    { title: "Bathroom", overdue: false },
  ]);
  assert.equal(many.title, "3 chores to do");
  assert.equal(many.detail, "2 of them overdue");
  assert.equal(many.color, DORM);
});

test("and only claims a clear day when it really is one", () => {
  const h = build([]);
  assert.equal(h.kind, "clear");
  assert.equal(h.title, "Nothing on");
  assert.equal(h.color, null);
});

test("relative time never reads like a machine wrote it", () => {
  assert.equal(relativeTime(0), "in a moment");
  assert.equal(relativeTime(1), "in a minute");
  assert.equal(relativeTime(2), "in 2 minutes");
  assert.equal(relativeTime(59), "in 59 minutes");
  assert.equal(relativeTime(60), "in 1 hour");
  assert.equal(relativeTime(80), "in 1 hour 20 min");
  assert.equal(relativeTime(120), "in 2 hours");
  // Far enough away that the minutes are noise rather than information.
  assert.equal(relativeTime(372), "in 6 hours");
});
