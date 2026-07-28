import {
  checkAllWantPrices,
  checkWantPrice,
  toggleListItem,
} from "@/lib/actions";
import type { ListItem } from "@/lib/data";
import { SubmitButton } from "@/components/forms";
import { Empty } from "@/components/ui";
import { money, sinceLabel } from "./money";

/**
 * Wants — the things you're saving up for.
 *
 * Unlike a grocery, a Want is one identifiable product, so a real retailer
 * lookup works. Best Buy publishes prices, so these update themselves and
 * show what's changed since the last check.
 */
export function Wants({
  open,
  done,
  hasApiKey,
  nearestStore,
}: {
  open: ListItem[];
  done: ListItem[];
  hasApiKey: boolean;
  nearestStore: string | null;
}) {
  return (
    <>
      {!hasApiKey && (
        <div className="mb-3 rounded-xl border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-sm">
          <p className="font-medium">Prices aren&rsquo;t updating yet.</p>
          <p className="mt-1 text-muted">
            This needs a free Best Buy API key set as{" "}
            <code>BESTBUY_API_KEY</code> on the server. Until then Wants are
            just a list — better that than showing a price that might be months
            old as though it were today&rsquo;s.
          </p>
        </div>
      )}

      {open.length === 0 ? (
        <Empty>Nothing on the wish list.</Empty>
      ) : (
        <ul className="space-y-2">
          {open.map((item) => {
            const price = item.price_cents;
            const wasCheaper =
              price !== null &&
              item.previous_price_cents !== null &&
              item.previous_price_cents !== price;
            const dropped =
              wasCheaper && price < (item.previous_price_cents ?? price);

            return (
              <li
                key={item.id}
                className="overflow-hidden rounded-xl border border-border bg-surface"
              >
                <div className="flex items-start gap-3 p-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{item.text}</p>
                    {item.retailer_name && (
                      <p className="mt-0.5 truncate text-xs text-muted">
                        {item.retailer_name}
                      </p>
                    )}

                    {price !== null ? (
                      <p className="mt-1.5 flex flex-wrap items-baseline gap-x-2">
                        <span className="text-lg font-semibold">
                          {money(price)}
                        </span>
                        {item.regular_price_cents !== null && (
                          <span className="text-xs text-muted line-through">
                            {money(item.regular_price_cents)}
                          </span>
                        )}
                        {wasCheaper && (
                          <span
                            className={`text-xs font-medium ${
                              dropped ? "text-emerald-600" : "text-red-500"
                            }`}
                          >
                            {dropped ? "↓" : "↑"}{" "}
                            {money(
                              Math.abs(
                                price - (item.previous_price_cents ?? price),
                              ),
                            )}{" "}
                            since last check
                          </span>
                        )}
                      </p>
                    ) : (
                      <p className="mt-1.5 text-sm text-muted">No price yet</p>
                    )}

                    <p className="mt-1 text-xs text-muted">
                      {sinceLabel(item.price_checked_at)}
                      {item.retailer_url ? (
                        <>
                          {" · "}
                          <a
                            href={item.retailer_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-accent underline"
                          >
                            View at Best Buy
                          </a>
                        </>
                      ) : null}
                    </p>

                    {item.price_error && (
                      <p className="mt-1 text-xs text-red-500">
                        {item.price_error}
                      </p>
                    )}
                  </div>

                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <form action={checkWantPrice.bind(null, item.id)}>
                      <SubmitButton variant="quiet" className="px-2 py-1 text-xs">
                        Check
                      </SubmitButton>
                    </form>
                    <form action={toggleListItem.bind(null, item.id)}>
                      <SubmitButton variant="danger" className="px-2 py-1 text-xs">
                        Got it
                      </SubmitButton>
                    </form>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-3 flex items-center gap-3">
        <form action={checkAllWantPrices}>
          <SubmitButton variant="quiet">Check all prices</SubmitButton>
        </form>
        {nearestStore && (
          <p className="text-xs text-muted">Nearest store: {nearestStore}</p>
        )}
      </div>

      {done.length > 0 && (
        <>
          <h3 className="mb-2 mt-6 text-xs font-semibold uppercase tracking-wider text-muted">
            Bought ({done.length})
          </h3>
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
            {done.map((item) => (
              <li key={item.id} className="px-2 py-1">
                <form action={toggleListItem.bind(null, item.id)}>
                  <button
                    type="submit"
                    className="flex w-full items-center gap-3 px-2 py-2 text-left"
                  >
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded border border-accent bg-accent text-[10px] text-white">
                      ✓
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm text-muted line-through">
                      {item.text}
                    </span>
                    {item.price_cents !== null && (
                      <span className="shrink-0 text-xs text-muted">
                        {money(item.price_cents)}
                      </span>
                    )}
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
