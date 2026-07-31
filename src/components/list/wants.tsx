import {
  checkAllWantPrices,
  checkWantPrice,
  deleteListItem,
  setWantPrice,
  toggleListItem,
} from "@/lib/actions";
import type { ListItem, Person } from "@/lib/data";
import { DORM_COLOR } from "@/lib/colors";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Empty, OwnerTile, listClass } from "@/components/ui";
import { EditItemForm, EditItemLink } from "./edit-item";
import { money, shopLabel, sinceLabel } from "./money";
import { ArrowDown, ArrowUp, Check, Trash2, TriangleAlert } from "lucide-react";

/**
 * Wants — the things you're saving up for.
 *
 * Unlike a grocery, a Want is one identifiable product, so a real lookup
 * works. Each one is priced by Best Buy's API, by reading the page at a link
 * you pasted, or by hand — and says which, because "checked" and "you typed
 * this in March" are not the same claim.
 */
export function Wants({
  open,
  done,
  hasApiKey,
  nearestStore,
  people,
  editId,
}: {
  open: ListItem[];
  done: ListItem[];
  hasApiKey: boolean;
  nearestStore: string | null;
  people: Person[];
  /** The item whose edit form is open, from `?edit=`. */
  editId: number | null;
}) {
  return (
    <>
      {/* Only when something actually depends on it. Link-priced items update
          perfectly well without a Best Buy key, and warning about one they
          don't use would be noise.

          One line, with the explanation folded away: it's a standing condition,
          not an emergency, and six lines of amber every visit read as one. */}
      {!hasApiKey && open.some((item) => item.retailer === "bestbuy") && (
        <details className="group mb-3 rounded-xl border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-sm">
          <summary className="flex cursor-pointer list-none items-center gap-2 text-muted">
            <TriangleAlert
              className="h-4 w-4 shrink-0 text-amber-500"
              strokeWidth={1.8}
              aria-hidden="true"
            />
            <span className="min-w-0 flex-1">
              Best Buy prices aren&rsquo;t updating
            </span>
            <span className="shrink-0 text-xs text-accent group-open:hidden">
              Why?
            </span>
          </summary>
          <p className="mt-2 text-muted">
            It needs a free Best Buy API key set as <code>BESTBUY_API_KEY</code>{" "}
            on the server. In the meantime you can paste a link to the product at
            another shop, or type the price in — the list tracks either, it just
            won&rsquo;t claim to have checked.
          </p>
        </details>
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
                  {/* Leading the row, as on every other screen. It used to be
                      the owner's name in coloured text off to the right of the
                      title, which is a different pattern for the same fact. */}
                  <OwnerTile
                    color={item.added_by_color ?? DORM_COLOR}
                    name={item.added_by_name}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="min-w-0 text-sm font-medium">{item.text}</p>
                    </div>
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
                            {dropped ? (
                              <ArrowDown className="inline h-3 w-3" strokeWidth={2.5} aria-hidden="true" />
                            ) : (
                              <ArrowUp className="inline h-3 w-3" strokeWidth={2.5} aria-hidden="true" />
                            )}{" "}
                            {money(
                              Math.abs(
                                price - (item.previous_price_cents ?? price),
                              ),
                            )}{" "}
                            since last time
                          </span>
                        )}
                      </p>
                    ) : (
                      <p className="mt-1.5 text-sm text-muted">No price yet</p>
                    )}

                    <p className="mt-1 text-xs text-muted">
                      {sinceLabel(item.price_checked_at, item.price_source)}
                      {item.retailer_url ? (
                        <>
                          {" · "}
                          <a
                            href={item.retailer_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-accent underline"
                          >
                            View at {shopLabel(item)}
                          </a>
                        </>
                      ) : null}
                    </p>

                    {/* A missing key is a standing condition of the whole
                        screen, not a fault of this one item — the amber bar at
                        the top already says it, and repeating it in red under
                        every item said the same sentence up to four times, and
                        only under the items that happened to have been checked
                        once.

                        Narrow on purpose: this hides the error only for the
                        items the missing key actually explains. A link-priced
                        item whose page wouldn't parse has nothing to do with
                        Best Buy, and still says so. */}
                    {item.price_error &&
                      !(item.retailer === "bestbuy" && !hasApiKey) && (
                      <p className="mt-1 text-xs text-red-500">
                        {item.price_error}
                      </p>
                    )}
                  </div>

                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <EditItemLink item={item} tab="wants" />
                    {item.retailer !== null && (
                      <form action={checkWantPrice.bind(null, item.id)}>
                        <SubmitButton variant="quiet" size="sm">
                          Check
                        </SubmitButton>
                      </form>
                    )}
                    <form action={toggleListItem.bind(null, item.id)}>
                      <SubmitButton variant="quiet" size="sm">
                        Got it
                      </SubmitButton>
                    </form>
                  </div>
                </div>

                {editId === item.id && (
                  <div className="border-t border-border px-3 pb-3">
                    <EditItemForm item={item} people={people} tab="wants" />
                  </div>
                )}

                {/* Type the price in yourself. Useful whether or not the
                    lookup is working: no key yet, a shop that has no API, or
                    a match that came back as the wrong model. */}
                <ActionForm
                  action={setWantPrice}
                  className="border-t border-border px-3 py-2"
                  resetOnSuccess
                >
                  <input type="hidden" name="item_id" value={item.id} />
                  <div className="flex items-center gap-2">
                    <label
                      htmlFor={`want-price-${item.id}`}
                      className="shrink-0 text-xs text-muted"
                    >
                      {price === null ? "What does it cost?" : "New price?"}
                    </label>
                    {/* Not `fieldClass`: its w-full collapses to nothing next
                        to the label, leaving a box too narrow to read. */}
                    <input
                      id={`want-price-${item.id}`}
                      name="price"
                      inputMode="decimal"
                      autoComplete="off"
                      aria-label={`What ${item.text} costs now`}
                      placeholder="—"
                      className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-2 py-1 text-right text-sm outline-none placeholder:text-muted focus:border-accent"
                    />
                    <SubmitButton variant="quiet" size="sm">
                      Save
                    </SubmitButton>
                  </div>
                </ActionForm>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-3 flex items-center gap-3">
        <form action={checkAllWantPrices}>
          <SubmitButton variant="quiet" size="sm">
            Check all prices
          </SubmitButton>
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
          <ul className={listClass}>
            {done.map((item) => (
              <li key={item.id} className="flex items-center gap-2 px-2 py-1">
                <form
                  action={toggleListItem.bind(null, item.id)}
                  className="min-w-0 flex-1"
                >
                  <button
                    type="submit"
                    className="flex w-full items-center gap-3 px-2 py-2 text-left"
                  >
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded border border-accent bg-accent text-white">
                      <Check className="h-3 w-3" strokeWidth={3} aria-hidden="true" />
                    </span>
                    {/* As in the cart on Needs: bought doesn't mean nobody's. */}
                    <OwnerTile
                      color={item.added_by_color ?? DORM_COLOR}
                      name={item.added_by_name}
                    />
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
                <form action={deleteListItem.bind(null, item.id)}>
                  <SubmitButton
                    variant="danger"
                    size="icon"
                    title={`Delete ${item.text} permanently`}
                  >
                    <Trash2 className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
                  </SubmitButton>
                </form>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
