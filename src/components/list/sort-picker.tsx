import Link from "next/link";
import { LIST_SORTS, type ListSort } from "@/lib/list-sort";

/**
 * Three links, not a dropdown.
 *
 * A `<select>` here would need either a Save button beside it or a script to
 * submit on change; links need neither, and the choice is one tap rather than
 * two. It also means the order is in the address, so the back button undoes it
 * and a page reload keeps it.
 *
 * Hidden when there's nothing to sort. Offering to reorder one item is the kind
 * of control that makes an app feel like a form.
 */
export function SortPicker({
  tab,
  current,
  itemCount,
}: {
  tab: "needs" | "wants";
  current: ListSort;
  itemCount: number;
}) {
  if (itemCount < 2) return null;

  return (
    <div className="mb-2 flex items-center justify-end gap-1 px-1">
      <span className="mr-auto text-xs text-muted">Sort by</span>
      {LIST_SORTS.map(({ value, label }) => {
        const active = value === current;
        return (
          <Link
            key={value}
            // "added" is the default, so it needs no parameter — which keeps
            // the plain /list address meaning what it always did.
            href={
              value === "added"
                ? `/list?tab=${tab}`
                : `/list?tab=${tab}&sort=${value}`
            }
            aria-current={active ? "true" : undefined}
            className={`pressable rounded-md px-2 py-1 text-xs font-medium transition-colors ${
              active
                ? "bg-accent text-white"
                : "text-muted hover:text-foreground"
            }`}
          >
            {label}
          </Link>
        );
      })}
    </div>
  );
}
