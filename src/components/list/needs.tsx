import {
  deleteListItem,
  setItemPrice,
  toggleListItem,
} from "@/lib/actions";
import type { ListItem } from "@/lib/data";
import { ActionForm, SubmitButton, fieldClass } from "@/components/forms";
import { Empty } from "@/components/ui";
import { EditItemForm, EditItemLink } from "./edit-item";
import { money } from "./money";

/**
 * Needs — the groceries.
 *
 * No API prices these, because no API covers Aldi or Martin's, and a price
 * that isn't from the shop you're standing in is worse than none. So the app
 * remembers what *you* paid: type it in when you tick something off, and next
 * time it shows what it cost last.
 */
export function Needs({
  open,
  done,
  estimate,
  editId,
}: {
  open: ListItem[];
  done: ListItem[];
  estimate: { totalCents: number; unpriced: number };
  /** The item whose rename form is open, from `?edit=`. */
  editId: number | null;
}) {
  return (
    <>
      {open.length === 0 ? (
        <Empty>Nothing on the list.</Empty>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
          {open.map((item) => (
            <li key={item.id} className="px-2 py-1">
              <div className="flex items-center gap-2">
              {/* min-w-0: a flex child won't shrink below its content by
                  default, so a long item name pushes the row wider than the
                  card instead of truncating inside it. */}
              <form
                action={toggleListItem.bind(null, item.id)}
                className="min-w-0 flex-1"
              >
                <button
                  type="submit"
                  className="flex w-full items-center gap-3 px-2 py-2 text-left"
                >
                  <span className="h-4 w-4 shrink-0 rounded border border-muted" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{item.text}</span>
                    {item.last_price_cents !== null && (
                      <span className="block text-xs text-muted">
                        last time {money(item.last_price_cents)}
                      </span>
                    )}
                  </span>
                  {item.added_by_name && (
                    <span
                      className="shrink-0 text-xs"
                      style={{ color: item.added_by_color ?? undefined }}
                    >
                      {item.added_by_name}
                    </span>
                  )}
                </button>
              </form>
              <EditItemLink item={item} tab="needs" />
              </div>
              {editId === item.id && <EditItemForm item={item} tab="needs" />}
            </li>
          ))}
        </ul>
      )}

      {open.length > 0 && (
        <p className="mt-2 px-1 text-xs text-muted">
          {estimate.totalCents > 0
            ? `About ${money(estimate.totalCents)} based on what these cost last time`
            : "Add prices as you shop and this will start estimating the trip"}
          {estimate.unpriced > 0 && estimate.totalCents > 0
            ? ` · ${estimate.unpriced} with no price yet`
            : ""}
        </p>
      )}

      {done.length > 0 && (
        <>
          <h3 className="mb-2 mt-6 text-xs font-semibold uppercase tracking-wider text-muted">
            In the cart ({done.length})
          </h3>
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
            {done.map((item) => (
              <li key={item.id} className="px-2 py-1">
                <div className="flex items-center gap-2">
                  <form
                    action={toggleListItem.bind(null, item.id)}
                    className="min-w-0 flex-1"
                  >
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
                    </button>
                  </form>

                  {/* Asked for at the moment you'd know it: the thing is in
                      the trolley and the price is in front of you. */}
                  <ActionForm action={setItemPrice} className="shrink-0">
                    <input type="hidden" name="item_id" value={item.id} />
                    <div className="flex items-center gap-1">
                      <input
                        name="price"
                        inputMode="decimal"
                        defaultValue={
                          item.last_price_cents !== null
                            ? (item.last_price_cents / 100).toFixed(2)
                            : ""
                        }
                        aria-label={`What ${item.text} cost`}
                        placeholder="$"
                        className={`${fieldClass} w-20 px-2 py-1 text-right text-sm`}
                      />
                      <SubmitButton variant="quiet" className="px-2 py-1 text-xs">
                        Save
                      </SubmitButton>
                    </div>
                  </ActionForm>

                  {/* Gone for good. The remembered price isn't — see
                      deleteListItem — so re-adding it still knows the cost. */}
                  <form action={deleteListItem.bind(null, item.id)}>
                    <SubmitButton
                      variant="danger"
                      title={`Delete ${item.text} permanently`}
                      className="px-2 py-1"
                    >
                      ✕
                    </SubmitButton>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
