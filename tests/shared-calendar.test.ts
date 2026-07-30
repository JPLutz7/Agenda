/**
 * Which calendar names mean "the flat".
 *
 * This decides whether an iCloud calendar reads as one person's or as the
 * apartment's, and being the apartment's is what puts its events in the shared
 * colour and into the reminders that go to both phones. It runs once against a
 * real database, so the rule itself is worth pinning: the risk isn't missing
 * "Dorm", it's sweeping in a calendar that only happens to contain those
 * letters.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { looksLikeSharedCalendar } from "../src/lib/colors.ts";

test("the household's own calendar is recognised, however it's written", () => {
  for (const name of [
    "Dorm",
    "dorm",
    "DORM",
    "Dorm stuff",
    "The Dorm",
    "Apartment",
    "Apt 4B",
    "Household",
    "Roommates",
  ]) {
    assert.equal(looksLikeSharedCalendar(name), true, `"${name}"`);
  }
});

test("a name that merely contains those letters is left alone", () => {
  for (const name of [
    "Dormitory lectures",
    "Aptal",
    "Adaptations",
    "Joao",
    "Nino",
    "Work",
    "Classes",
    "Soccer",
    "",
  ]) {
    assert.equal(looksLikeSharedCalendar(name), false, `"${name}"`);
  }
});
