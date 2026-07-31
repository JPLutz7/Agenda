/**
 * How the shopping list is ordered.
 *
 * Three answers to three different questions. "Added" is the order things were
 * put on, which is what a list is by default and what you want while you're
 * still writing it. "Price" is for the moment before you go — what's actually
 * driving the total, most expensive first. "Whose" groups the list by the
 * person it belongs to, which is how you split a trip between two people.
 *
 * Pure and away from the database: the lists are a few dozen rows, so there is
 * nothing to gain from doing this in SQL, and the two categories price
 * themselves from different columns — one query with a CASE in its ORDER BY
 * would be harder to read than this and impossible to test on its own.
 */

export type ListSort = "added" | "price" | "owner";

export const LIST_SORTS: { value: ListSort; label: string }[] = [
  { value: "added", label: "Added" },
  { value: "price", label: "Price" },
  { value: "owner", label: "Whose" },
];

export function isListSort(value: string | undefined): value is ListSort {
  return value === "added" || value === "price" || value === "owner";
}

/** The shape this needs from a row. `ListItem` satisfies it. */
export type SortableItem = {
  category: string;
  /** Needs: what it cost last time. */
  last_price_cents: number | null;
  /** Wants: the tracked or hand-typed price. */
  price_cents: number | null;
  /** Null is the dorm's. */
  added_by_name: string | null;
};

/**
 * What "the price" means for a row, which is a different column per category:
 * a Need remembers what you last paid, a Want carries what it costs now.
 */
export function priceOf(item: SortableItem): number | null {
  return item.category === "want" ? item.price_cents : item.last_price_cents;
}

/**
 * Sorted, without touching the array it was given.
 *
 * Every comparison falls through to 0 when the keys match, which leaves
 * equal items in the order they arrived — so "whose" keeps each person's
 * things in the order they added them rather than shuffling them about.
 */
export function sortListItems<T extends SortableItem>(
  items: T[],
  sort: ListSort,
): T[] {
  if (sort === "added") return items;

  if (sort === "price") {
    return [...items].sort((a, b) => {
      const left = priceOf(a);
      const right = priceOf(b);
      // Anything with no price sinks, whichever way round the prices are.
      // Sorting by a number you don't have would otherwise put a whole run of
      // unpriced things at the top, which reads as "these are the free ones".
      if (left === null && right === null) return 0;
      if (left === null) return 1;
      if (right === null) return -1;
      return right - left;
    });
  }

  return [...items].sort((a, b) => {
    // The dorm's things first: it's the default owner, so it's the biggest
    // group and the one that isn't anybody's job in particular.
    const left = a.added_by_name;
    const right = b.added_by_name;
    if (left === right) return 0;
    if (left === null) return -1;
    if (right === null) return 1;
    return left.localeCompare(right, "en", { sensitivity: "base" });
  });
}
