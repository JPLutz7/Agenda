import { requireSignedIn } from "@/lib/guard";
import { getListItems, getPeople } from "@/lib/data";
import { addListItem, clearCheckedItems, toggleListItem } from "@/lib/actions";
import { ActionForm, SubmitButton, fieldClass } from "@/components/forms";
import { Empty, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function ListPage() {
  await requireSignedIn();
  const { open, done } = getListItems();
  const people = getPeople();

  return (
    <>
      <PageHeader
        title="Shopping list"
        subtitle="Whatever the apartment is out of."
      />

      <ActionForm action={addListItem} className="mb-5" resetOnSuccess>
        <div className="flex gap-2">
          <input
            name="text"
            required
            autoComplete="off"
            className={fieldClass}
            placeholder="Paper towels"
          />
          {people.length > 0 && (
            <select
              name="added_by"
              defaultValue={people[0].id}
              aria-label="Added by"
              className="rounded-lg border border-border bg-surface px-2 text-sm"
            >
              {people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </select>
          )}
          <SubmitButton>Add</SubmitButton>
        </div>
      </ActionForm>

      {open.length === 0 ? (
        <Empty>Nothing on the list.</Empty>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
          {open.map((item) => (
            <li key={item.id} className="flex items-center gap-3 px-2 py-1">
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
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {item.text}
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
            </li>
          ))}
        </ul>
      )}

      {done.length > 0 && (
        <>
          <div className="mb-2 mt-7 flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">
              In the cart ({done.length})
            </h2>
            <form action={clearCheckedItems}>
              <SubmitButton variant="danger" className="px-2 py-1">
                Clear
              </SubmitButton>
            </form>
          </div>
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
            {done.map((item) => (
              <li key={item.id} className="flex items-center gap-3 px-2 py-1">
                <form
                  action={toggleListItem.bind(null, item.id)}
                  className="flex-1"
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
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
