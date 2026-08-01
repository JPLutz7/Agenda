/**
 * What the shopping list adds up to.
 *
 * Money on a screen two people settle up from, so it's worth pinning: the two
 * categories add up different columns, an item with no price must lower the
 * total without disappearing from the count, and people are told apart by id
 * rather than by the name that happens to be printed.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  perPerson,
  totalOf,
  totalsByOwner,
  type TotalledItem,
} from "../src/lib/list-totals.ts";

const need = (
  last_price_cents: number | null,
  added_by: number | null = null,
  added_by_name: string | null = null,
): TotalledItem => ({
  category: "need",
  last_price_cents,
  price_cents: null,
  added_by,
  added_by_name,
  added_by_color: added_by_name ? "#2563eb" : null,
});

const want = (
  price_cents: number | null,
  added_by: number | null = null,
  added_by_name: string | null = null,
): TotalledItem => ({
  category: "want",
  last_price_cents: null,
  price_cents,
  added_by,
  added_by_name,
  added_by_color: added_by_name ? "#2563eb" : null,
});

test("one total is the sum of what the things last cost", () => {
  const total = totalOf([need(499), need(2999), need(899)]);
  assert.equal(total.cents, 4397);
  assert.equal(total.count, 3);
  assert.equal(total.unpriced, 0);
});

test("an item with no price is counted but adds nothing", () => {
  const total = totalOf([need(499), need(null), need(null)]);
  assert.equal(total.cents, 499);
  assert.equal(total.unpriced, 2);
  assert.equal(total.count, 3);
});

test("an empty list totals zero rather than blowing up", () => {
  assert.deepEqual(totalOf([]), {
    name: null,
    color: null,
    cents: 0,
    unpriced: 0,
    count: 0,
  });
});

test("a Want totals what it costs now, not a Need's column", () => {
  // Both columns are populated on purpose: reading the wrong one is the exact
  // mistake this guards, and it can only be seen when the two differ.
  const crossed: TotalledItem = {
    category: "want",
    price_cents: 28999,
    last_price_cents: 100,
    added_by: null,
    added_by_name: null,
    added_by_color: null,
  };
  assert.equal(totalOf([crossed]).cents, 28999);
});

test("each person gets their own total, and the dorm comes first", () => {
  const totals = totalsByOwner([
    want(4500, 1, "Joao"),
    want(28999, null, null),
    want(2999, 2, "Nino"),
    want(1000, 1, "Joao"),
  ]);
  assert.deepEqual(
    totals.map((t) => [t.name, t.cents]),
    [
      [null, 28999],
      ["Joao", 5500],
      ["Nino", 2999],
    ],
  );
});

test("people with nothing on the list are left out entirely", () => {
  const totals = totalsByOwner([want(4500, 1, "Joao")]);
  assert.equal(totals.length, 1);
  assert.equal(totals[0].name, "Joao");
});

test("someone's unpriced things are counted against their own total", () => {
  const totals = totalsByOwner([
    want(null, 1, "Joao"),
    want(4500, 1, "Joao"),
    want(null, null, null),
  ]);
  assert.deepEqual(
    totals.map((t) => [t.name, t.cents, t.unpriced, t.count]),
    [
      [null, 0, 1, 1],
      ["Joao", 4500, 1, 2],
    ],
  );
});

test("two people with the same name keep separate totals", () => {
  const totals = totalsByOwner([want(1000, 1, "J"), want(2000, 2, "J")]);
  assert.deepEqual(
    totals.map((t) => t.cents),
    [1000, 2000],
  );
});

test("a shared thing costs each of two people half of it", () => {
  assert.equal(perPerson(28999, 2), 14500); // $289.99 -> $145.00
  assert.equal(perPerson(4500, 2), 2250);
});

test("and a third roommate makes it a third, not still a half", () => {
  assert.equal(perPerson(30000, 3), 10000);
});

test("an odd number of cents rounds rather than losing the penny", () => {
  // Two halves of $2.99 come to $3.00. Deliberate: this is the "can I afford
  // it" figure, and the direction that can't disappoint is up.
  assert.equal(perPerson(299, 2), 150);
});

test("there is no share when there is nobody to share with", () => {
  assert.equal(perPerson(28999, 1), null);
  assert.equal(perPerson(28999, 0), null);
});

test("nothing costs nobody anything, so no share is shown", () => {
  assert.equal(perPerson(0, 2), null);
});

test("the per-person totals add up to the one total", () => {
  const items = [
    need(499, null, null),
    need(2999, 2, "Nino"),
    need(899, 1, "Joao"),
    need(null, 1, "Joao"),
  ];
  const split = totalsByOwner(items).reduce((sum, t) => sum + t.cents, 0);
  assert.equal(split, totalOf(items).cents);
});
