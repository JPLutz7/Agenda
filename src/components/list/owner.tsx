import type { Person } from "@/lib/data";

/**
 * Whose item this is: the dorm, or one of the people in it.
 *
 * Stored as `list_items.added_by` — a person id, or null for the dorm.
 * Null is the default rather than "whoever happens to be first in the people
 * table", which is what it used to be: an unlabelled item on a shared list
 * belongs to the flat, and defaulting to a name meant everything Nino added
 * without touching the picker came out as João's.
 */

/** The value the select uses for "belongs to the dorm". */
export const DORM_VALUE = "dorm";

export function OwnerSelect({
  people,
  selected,
  className,
}: {
  people: Person[];
  /** Current owner: a person id, or null for the dorm. */
  selected: number | null;
  className?: string;
}) {
  return (
    <select
      name="added_by"
      defaultValue={selected === null ? DORM_VALUE : String(selected)}
      aria-label="Whose it is"
      className={className}
    >
      <option value={DORM_VALUE}>Dorm</option>
      {people.map((person) => (
        <option key={person.id} value={person.id}>
          {person.name}
        </option>
      ))}
    </select>
  );
}

// `OwnerTag` — the owner's name in coloured text at the end of a row — used to
// live here. Every screen now leads its rows with `OwnerTile` from
// `components/ui` instead, so the same fact isn't shown two different ways in
// two halves of the app.
