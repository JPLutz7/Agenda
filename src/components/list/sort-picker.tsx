import { chooseListSort } from "@/lib/actions";
import { LIST_SORTS, type ListSort } from "@/lib/list-sort";

/**
 * Three buttons, one of them already pressed — the same segmented control as
 * the light/dark picker in Setup, and remembered the same way.
 *
 * Each is its own form posting to a server action that writes a cookie, so the
 * choice sticks to the phone: leave the list, come back tomorrow, and it's
 * still in the order you left it. Keeping it in the address instead would mean
 * re-choosing on every arrival, since the tab bar and the notification both
 * link to a plain /list.
 *
 * No client-side JavaScript, and nothing in the URL to get out of step with
 * what's on screen.
 *
 * Hidden when there's nothing to sort. Offering to reorder one item is the kind
 * of control that makes an app feel like a form.
 */
export function SortPicker({
  current,
  itemCount,
}: {
  current: ListSort;
  itemCount: number;
}) {
  if (itemCount < 2) return null;

  return (
    <div
      role="group"
      aria-label="Sort the list"
      className="mb-2 flex items-center justify-end gap-1 px-1"
    >
      <span className="mr-auto text-xs text-muted">Sort by</span>
      {LIST_SORTS.map(({ value, label }) => {
        const active = value === current;
        return (
          <form key={value} action={chooseListSort.bind(null, value)}>
            <button
              type="submit"
              aria-pressed={active}
              className={`pressable rounded-md px-2 py-1 text-xs font-medium transition-colors ${
                active
                  ? "bg-accent text-white"
                  : "text-muted hover:text-foreground"
              }`}
            >
              {label}
            </button>
          </form>
        );
      })}
    </div>
  );
}
