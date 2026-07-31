/**
 * The shopping list's three orders.
 *
 * Worth pinning rather than eyeballing: the two categories take their price
 * from different columns, an item with no price at all is the common case
 * rather than the exception, and "stable" is load-bearing — grouping by person
 * has to leave each person's things in the order they added them.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isListSort,
  priceOf,
  sortListItems,
  type SortableItem,
} from "../src/lib/list-sort.ts";

const need = (
  name: string,
  last_price_cents: number | null,
  added_by_name: string | null = null,
): SortableItem & { name: string } => ({
  name,
  category: "need",
  last_price_cents,
  price_cents: null,
  added_by_name,
});

const want = (
  name: string,
  price_cents: number | null,
  added_by_name: string | null = null,
): SortableItem & { name: string } => ({
  name,
  category: "want",
  last_price_cents: null,
  price_cents,
  added_by_name,
});

const names = (items: { name: string }[]) => items.map((i) => i.name);

test("a Need is priced by what it last cost, a Want by what it costs now", () => {
  assert.equal(priceOf(need("Coffee", 899)), 899);
  assert.equal(priceOf(want("Monitor", 28999)), 28999);
  // Neither reads the other's column, which is the mistake one query would make.
  assert.equal(priceOf({ ...need("Coffee", null), price_cents: 500 }), null);
  assert.equal(priceOf({ ...want("Monitor", null), last_price_cents: 500 }), null);
});

test("added order is left exactly as it came", () => {
  const items = [need("Coffee", 899), need("Milk", 350), need("Bread", null)];
  const sorted = sortListItems(items, "added");
  assert.deepEqual(names(sorted), ["Coffee", "Milk", "Bread"]);
  // Handed straight back rather than copied — there is nothing to do.
  assert.equal(sorted, items);
});

test("by price is dearest first, and never reorders the originals", () => {
  const items = [need("Milk", 350), need("Coffee", 899), need("Bread", 250)];
  assert.deepEqual(names(sortListItems(items, "price")), [
    "Coffee",
    "Milk",
    "Bread",
  ]);
  assert.deepEqual(names(items), ["Milk", "Coffee", "Bread"]);
});

test("things with no price sink to the bottom rather than float to the top", () => {
  const items = [
    need("Bread", null),
    need("Coffee", 899),
    need("Napkins", null),
    need("Milk", 350),
  ];
  assert.deepEqual(names(sortListItems(items, "price")), [
    "Coffee",
    "Milk",
    // Still in the order they were added, among themselves.
    "Bread",
    "Napkins",
  ]);
});

test("Wants sort on their own price column", () => {
  const items = [want("Desk lamp", 4500), want("Monitor", 28999), want("Rug", null)];
  assert.deepEqual(names(sortListItems(items, "price")), [
    "Monitor",
    "Desk lamp",
    "Rug",
  ]);
});

test("by owner puts the dorm's first, then people by name", () => {
  const items = [
    need("Protein", 2999, "Nino"),
    need("Paper towels", 499, null),
    need("Coffee", 899, "Joao"),
    need("Bin bags", 299, null),
  ];
  assert.deepEqual(names(sortListItems(items, "owner")), [
    "Paper towels",
    "Bin bags",
    "Coffee",
    "Protein",
  ]);
});

test("and keeps each person's things in the order they added them", () => {
  const items = [
    need("Coffee", 899, "Joao"),
    need("Oats", 350, "Joao"),
    need("Tea", 250, "Joao"),
  ];
  assert.deepEqual(names(sortListItems(items, "owner")), [
    "Coffee",
    "Oats",
    "Tea",
  ]);
});

test("only the three real orders are accepted", () => {
  assert.equal(isListSort("added"), true);
  assert.equal(isListSort("price"), true);
  assert.equal(isListSort("owner"), true);
  assert.equal(isListSort("cheapest"), false);
  assert.equal(isListSort(undefined), false);
  assert.equal(isListSort(""), false);
});
