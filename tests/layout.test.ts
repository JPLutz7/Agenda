/**
 * Where blocks go in the day and week grids.
 *
 * A pure function, so this is cheap to test and worth testing precisely: the
 * owner's standing requirement is that "the title and time for the events
 * should always be apparent on the calendar", and every case below is a way
 * that could quietly stop being true.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_COLUMNS, blockGeometry, placeEvents } from "../src/lib/layout.ts";

const at = (key: string, startMinutes: number, endMinutes: number) => ({
  key,
  startMinutes,
  endMinutes,
});
const widths = (list: { key: string; width: number }[]) =>
  Object.fromEntries(list.map((e) => [e.key, Number(e.width.toFixed(4))]));

test("one event takes the whole column", () => {
  const { placed, overflow } = placeEvents([at("a", 540, 600)]);
  assert.equal(placed.length, 1);
  assert.equal(placed[0].width, 1);
  assert.equal(placed[0].left, 0);
  assert.deepEqual(overflow, []);
});

test("events that don't overlap each keep the whole column", () => {
  const { placed } = placeEvents([at("a", 540, 600), at("b", 780, 840)]);
  assert.deepEqual(widths(placed), { a: 1, b: 1 });
});

test("two at once split it evenly", () => {
  const { placed } = placeEvents([at("a", 540, 660), at("b", 570, 690)]);
  assert.deepEqual(widths(placed), { a: 0.5, b: 0.5 });
  assert.deepEqual(
    placed.map((e) => e.column).sort(),
    [0, 1],
    "they must take different slots or they'd be drawn on top of each other",
  );
});

test("three at once split into thirds", () => {
  const { placed, overflow } = placeEvents([
    at("a", 540, 660),
    at("b", 550, 660),
    at("c", 560, 660),
  ]);
  assert.equal(placed.length, 3);
  for (const block of placed) {
    assert.ok(
      Math.abs(block.width - 1 / 3) < 1e-9,
      `expected a third, got ${block.width}`,
    );
  }
  assert.deepEqual(overflow, []);
});

test("a fourth is hidden behind a chip rather than squeezed to nothing", () => {
  // This is the decision the app makes about the owner's requirement: a quarter
  // of a week column is 27px, narrower than one character, so a fourth block
  // would show no text at all. Better to say "3 more" than to draw a sliver.
  const { placed, overflow } = placeEvents([
    at("a", 540, 660),
    at("b", 545, 660),
    at("c", 550, 660),
    at("d", 555, 660),
  ]);
  assert.equal(placed.length, MAX_COLUMNS);
  assert.equal(overflow.length, 1);
  assert.deepEqual(overflow[0].events.map((e) => e.key), ["d"]);
  // Every drawn block still gets a readable share.
  for (const block of placed) {
    assert.ok(block.width >= 1 / MAX_COLUMNS - 1e-9);
  }
});

test("a hidden event doesn't push the visible ones around", () => {
  const three = placeEvents([at("a", 540, 660), at("b", 545, 660), at("c", 550, 660)]);
  const four = placeEvents([
    at("a", 540, 660),
    at("b", 545, 660),
    at("c", 550, 660),
    at("d", 555, 660),
  ]);
  assert.deepEqual(
    widths(four.placed),
    widths(three.placed),
    "adding a hidden fourth must not change the first three",
  );
});

test("a long event doesn't narrow the parts of the day it isn't in", () => {
  // A 9-to-5 plus a lunch meeting. Without clustering by actual overlap, the
  // 9-to-5 would halve the whole column, including the evening.
  const { placed } = placeEvents([
    at("workday", 540, 1020),
    at("lunch", 720, 780),
    at("dinner", 1140, 1200),
  ]);
  assert.equal(widths(placed).dinner, 1, "the evening is uncontested");
  assert.equal(widths(placed).workday, 0.5);
  assert.equal(widths(placed).lunch, 0.5);
});

test("two events minutes apart still count as overlapping", () => {
  // Each block needs room for a line of text, so a 5-minute event at 9:00 and
  // another at 9:05 would be drawn on top of each other if treated as separate.
  const { placed } = placeEvents([at("a", 540, 545), at("b", 545, 550)]);
  assert.deepEqual(widths(placed), { a: 0.5, b: 0.5 });
});

test("a morning and an afternoon event can share one slot", () => {
  // Three in a chain, never more than two deep at once: all three are drawn.
  const { placed, overflow } = placeEvents([
    at("morning", 540, 660),
    at("overlapper", 600, 900),
    at("afternoon", 780, 900),
  ]);
  assert.equal(placed.length, 3);
  assert.deepEqual(overflow, []);
});

test("geometry gives every block room for its text", () => {
  const tall = blockGeometry(at("a", 540, 660));
  assert.ok(tall.top > 0 && tall.height > 0);

  // A zero-length event still has to be tall enough to read.
  const tiny = blockGeometry(at("b", 540, 540));
  assert.ok(tiny.height > 0, "a zero-length event must still be visible");

  // Midnight sits at the top of the day.
  assert.equal(blockGeometry(at("c", 0, 60)).top, 0);
});
