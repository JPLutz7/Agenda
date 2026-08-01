import { DORM_COLOR } from "@/lib/colors";
import { totalOf, totalsByOwner, type TotalledItem } from "@/lib/list-totals";
import { OwnerTile, ownerWash, panelClass } from "@/components/ui";
import { money } from "./money";

/**
 * What the list comes to, across the top of it.
 *
 * At the top rather than the bottom because it's the reason you opened the
 * screen before a shop, and on a phone the bottom of a list of twenty things
 * is a scroll away. It reads as a header, not as a footnote.
 *
 * Wants are split per person and Needs are not, because they're different
 * kinds of money: a grocery run is one trolley through one till, while a wish
 * list is three separate piles of saving-up that happen to share a screen.
 */
export function ListTotals({
  items,
  kind,
}: {
  items: TotalledItem[];
  kind: "needs" | "wants";
}) {
  // Nothing on the list is not a total of zero, it's an absence — and an empty
  // list already says so in its own words.
  if (items.length === 0) return null;

  if (kind === "needs") {
    const total = totalOf(items);

    // Before anything has ever been priced there is no total to show, and a
    // large $0.00 would read as "this trip is free" rather than "we don't know
    // yet". Say what to do instead.
    if (total.cents === 0) {
      return (
        <p className="mb-3 px-1 text-xs text-muted">
          Type in what things cost as you shop, and this will start estimating
          the trip.
        </p>
      );
    }

    return (
      <div className={`${panelClass} mb-3 px-3 py-2.5`}>
        <p className="text-xs text-muted">
          About this much, going on what these cost last time
        </p>
        <p className="mt-1 font-display text-2xl font-semibold tabular-nums">
          {money(total.cents)}
        </p>
        {total.unpriced > 0 && <Unpriced count={total.unpriced} />}
      </div>
    );
  }

  return (
    <div className={`${panelClass} mb-3 overflow-hidden`}>
      {/* A grid rather than a row of flexible columns, and this is the whole
          reason: with a fourth person on the list, equal columns squeezed
          $1,299.00 down to "$1,299.0" — a clipped price is worse than no
          price. auto-fit keeps every column wide enough to hold the money and
          wraps to a second line instead, so adding a person can't break it. */}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(7rem,1fr))] gap-px">
        {totalsByOwner(items).map((total) => {
          const color = total.color ?? DORM_COLOR;
          return (
            <div
              key={total.name ?? "dorm"}
              className="min-w-0 px-3 py-2.5"
              style={{ background: ownerWash(color, "7%") }}
            >
              <div className="flex items-center gap-2">
                <OwnerTile color={color} name={total.name} />
                <span className="min-w-0 truncate text-xs text-muted">
                  {total.name ?? "Dorm"}
                </span>
              </div>
              <p className="mt-1.5 font-display text-lg font-semibold tabular-nums">
                {money(total.cents)}
              </p>
              {total.unpriced > 0 && <Unpriced count={total.unpriced} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Why the figure is lower than the list looks.
 *
 * Without it a total quietly means "of the ones we happen to know", which is
 * the sort of number people stop trusting the moment they notice.
 */
function Unpriced({ count }: { count: number }) {
  return (
    <p className="mt-0.5 text-[0.6875rem] leading-tight text-muted">
      {count} with no price
    </p>
  );
}
