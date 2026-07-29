import type { Person } from "@/lib/data";
import { HOUSEHOLD_COLOR } from "@/lib/colors";

/**
 * Whose item this is: the apartment, or one of the people in it.
 *
 * Stored as `list_items.added_by` — a person id, or null for the apartment.
 * Null is the default rather than "whoever happens to be first in the people
 * table", which is what it used to be: an unlabelled item on a shared list
 * belongs to the flat, and defaulting to a name meant everything Nino added
 * without touching the picker came out as João's.
 */

/** The value the select uses for "belongs to the apartment". */
export const HOUSEHOLD_VALUE = "household";

export function OwnerSelect({
  people,
  selected,
  className,
}: {
  people: Person[];
  /** Current owner: a person id, or null for the apartment. */
  selected: number | null;
  className?: string;
}) {
  return (
    <select
      name="added_by"
      defaultValue={selected === null ? HOUSEHOLD_VALUE : String(selected)}
      aria-label="Whose it is"
      className={className}
    >
      <option value={HOUSEHOLD_VALUE}>Apartment</option>
      {people.map((person) => (
        <option key={person.id} value={person.id}>
          {person.name}
        </option>
      ))}
    </select>
  );
}

/**
 * The little coloured name on a row. The apartment gets one too — without it,
 * choosing "Apartment" would look like the choice hadn't been saved.
 */
export function OwnerTag({
  name,
  color,
}: {
  name: string | null;
  color: string | null;
}) {
  return (
    <span
      className="shrink-0 text-xs font-medium"
      style={{ color: name ? (color ?? undefined) : HOUSEHOLD_COLOR }}
    >
      {name ?? "Apartment"}
    </span>
  );
}
