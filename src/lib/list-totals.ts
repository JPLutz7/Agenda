// Explicit .ts, as in headline.ts: the tests run the TypeScript directly with
// no bundler to guess the extension for them.
import { priceOf, type SortableItem } from "./list-sort.ts";

/**
 * What the list adds up to.
 *
 * Two different questions, so two different answers. A grocery run is one
 * number — what the trip will cost — because it's one trolley and one till. A
 * wish list is a number per person, because it isn't a purchase at all: it's
 * three separate piles of saving-up that happen to share a screen, and the
 * useful fact is how much *your* pile comes to.
 *
 * Pure, and given the rows the page already has rather than a second query. The
 * total has to be the sum of the things on screen — a figure worked out
 * separately in SQL is a second source of truth for one number, and the two
 * only have to disagree once to make the whole screen untrustworthy.
 */

/** The shape this needs from a row. `ListItem` satisfies it. */
export type TotalledItem = SortableItem & {
  /** Whose it is: a person id, or null for the dorm. */
  added_by: number | null;
  added_by_color: string | null;
};

export type Total = {
  /** Null is the dorm's. */
  name: string | null;
  color: string | null;
  cents: number;
  /** How many rows had no price to add, which is why the total can look low. */
  unpriced: number;
  count: number;
};

/** One line: everything, whoever it belongs to. */
export function totalOf(items: TotalledItem[]): Total {
  let cents = 0;
  let unpriced = 0;
  for (const item of items) {
    const price = priceOf(item);
    if (price === null) unpriced += 1;
    else cents += price;
  }
  return { name: null, color: null, cents, unpriced, count: items.length };
}

/**
 * One line per person, the dorm's first.
 *
 * Same order as sorting by "whose", so the totals along the top read in the
 * same order as the list under them — a header that disagrees with the list
 * below it makes you check both.
 *
 * Keyed by person id rather than by name, because the name is only what's
 * printed; two people called J. would otherwise pool their money.
 */
export function totalsByOwner(items: TotalledItem[]): Total[] {
  const groups = new Map<number | "dorm", Total>();

  for (const item of items) {
    const key = item.added_by ?? "dorm";
    const existing = groups.get(key) ?? {
      name: item.added_by_name,
      color: item.added_by_color,
      cents: 0,
      unpriced: 0,
      count: 0,
    };
    const price = priceOf(item);
    if (price === null) existing.unpriced += 1;
    else existing.cents += price;
    existing.count += 1;
    groups.set(key, existing);
  }

  // Only the people who actually have something on this list. A row of names
  // reading $0.00 is three quarters of the header spent saying "nothing".
  return [...groups.values()].sort((a, b) => {
    if (a.name === b.name) return 0;
    if (a.name === null) return -1;
    if (b.name === null) return 1;
    return a.name.localeCompare(b.name, "en", { sensitivity: "base" });
  });
}
