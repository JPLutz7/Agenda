import Link from "next/link";
import { updateListItem } from "@/lib/actions";
import type { ListItem, Person } from "@/lib/data";
import { ActionForm, Field, SubmitButton, fieldClass } from "@/components/forms";
import { OwnerSelect } from "./owner";

/**
 * Renaming something on the list.
 *
 * Which row is open lives in the URL (`?edit=12`) rather than in component
 * state, so this whole page stays server-rendered and the back button closes
 * the form. It also survives the app's own 45-second refresh, which would
 * otherwise shut the form while someone was still typing in it.
 */

/** Back to the list with nothing open. */
export function listHref(tab: "needs" | "wants"): string {
  return tab === "wants" ? "/list?tab=wants" : "/list";
}

export function EditItemLink({
  item,
  tab,
}: {
  item: ListItem;
  tab: "needs" | "wants";
}) {
  return (
    <Link
      href={`${listHref(tab)}${tab === "wants" ? "&" : "?"}edit=${item.id}`}
      title={`Edit ${item.text}`}
      className="shrink-0 rounded-lg px-2 py-2 text-sm text-muted hover:text-foreground"
    >
      ✎
    </Link>
  );
}

export function EditItemForm({
  item,
  people,
  tab,
}: {
  item: ListItem;
  people: Person[];
  tab: "needs" | "wants";
}) {
  const isWant = tab === "wants";

  return (
    <ActionForm
      action={updateListItem}
      className="mt-1 space-y-3 rounded-lg border border-border bg-surface-muted p-3"
    >
      <input type="hidden" name="item_id" value={item.id} />

      <Field label={isWant ? "Product" : "Item"}>
        <input
          name="text"
          required
          autoComplete="off"
          defaultValue={item.text}
          className={fieldClass}
        />
      </Field>

      {isWant && (
        <Field label="Search Best Buy for">
          <input
            name="search"
            autoComplete="off"
            defaultValue={item.retailer_query ?? item.text}
            className={fieldClass}
          />
        </Field>
      )}

      {people.length > 0 && (
        <Field label="Whose it is">
          <OwnerSelect
            people={people}
            selected={item.added_by}
            className={fieldClass}
          />
        </Field>
      )}

      {isWant && (
        <p className="text-xs text-muted">
          Changing the search unbinds the product it found last time and looks
          again — which is the fix when the price is for the wrong model.
        </p>
      )}

      <div className="flex items-center gap-2">
        <SubmitButton>Save</SubmitButton>
        <Link
          href={listHref(tab)}
          className="rounded-lg border border-border bg-surface px-3 py-2 text-sm font-medium"
        >
          Cancel
        </Link>
      </div>
    </ActionForm>
  );
}
