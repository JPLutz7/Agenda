import { requireSignedIn } from "@/lib/guard";
import { getChores, getPeople, timezone } from "@/lib/data";
import { addChore, updateChore } from "@/lib/actions";
import { today } from "@/lib/dates";
import {
  ActionForm,
  Disclosure,
  Field,
  SubmitButton,
  fieldClass,
} from "@/components/forms";
import {
  CompleteChoreButton,
  RemoveChoreButton,
  SnoozeChoreButton,
} from "@/components/chore-controls";
import { Empty, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function ChoresPage() {
  await requireSignedIn();
  const chores = getChores();
  const people = getPeople();
  const tz = timezone();

  return (
    <>
      <PageHeader
        title="Chores"
        subtitle="Whoever's turn it is. Marking one done passes the baton."
      />

      {chores.length === 0 ? (
        <Empty>No chores yet. Add the ones you keep arguing about.</Empty>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
          {chores.map((chore) => (
            <li key={chore.id} className="px-4 py-3">
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{chore.title}</p>
                <p className="mt-0.5 text-xs">
                  {chore.assignee ? (
                    <span
                      className="font-medium"
                      style={{ color: chore.assignee.color }}
                    >
                      {chore.assignee.name}
                    </span>
                  ) : (
                    <span className="text-muted">Unassigned</span>
                  )}
                  <span className={chore.overdue ? "text-red-500" : "text-muted"}>
                    {" · "}
                    {chore.dueLabel}
                  </span>
                  <span className="text-muted">
                    {" · every "}
                    {chore.cadence_days === 1
                      ? "day"
                      : chore.cadence_days === 7
                        ? "week"
                        : `${chore.cadence_days} days`}
                  </span>
                </p>
                {chore.lastDoneBy && (
                  <p className="mt-0.5 text-xs text-muted">
                    Last done by {chore.lastDoneBy}
                  </p>
                )}
              </div>
              <SnoozeChoreButton choreId={chore.id} />
              <CompleteChoreButton choreId={chore.id} />
              <RemoveChoreButton choreId={chore.id} />
            </div>

            {/* Folded away rather than on another screen: a chore is four
                fields, and the point of editing one is usually to see it next
                to the others while you change it. */}
            <details className="group mt-1">
              <summary className="cursor-pointer list-none py-1 text-xs font-medium text-accent">
                <span className="group-open:hidden">Edit</span>
                <span className="hidden group-open:inline">Cancel</span>
              </summary>
              <ActionForm
                action={updateChore}
                className="mt-2 space-y-3 rounded-lg border border-border bg-surface-muted p-3"
              >
                <input type="hidden" name="chore_id" value={chore.id} />
                <Field label="Chore">
                  <input
                    name="title"
                    required
                    defaultValue={chore.title}
                    className={fieldClass}
                  />
                </Field>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Repeat every (days)">
                    <input
                      name="cadence_days"
                      type="number"
                      min={1}
                      max={365}
                      defaultValue={chore.cadence_days}
                      className={fieldClass}
                    />
                  </Field>
                  <Field label="Next due">
                    <input
                      name="next_due_on"
                      type="date"
                      defaultValue={chore.next_due_on}
                      className={fieldClass}
                    />
                  </Field>
                </div>
                <Field label="Who does it">
                  <select
                    name="owner"
                    defaultValue={
                      chore.rotates
                        ? "rotate"
                        : String(chore.assignee?.id ?? "rotate")
                    }
                    className={fieldClass}
                  >
                    <option value="rotate">Rotate between us</option>
                    {people.map((person) => (
                      <option key={person.id} value={person.id}>
                        Always {person.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <SubmitButton>Save changes</SubmitButton>
              </ActionForm>
            </details>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-6">
        <Disclosure summary="Add a chore">
          <ActionForm action={addChore} className="space-y-3" resetOnSuccess>
            <Field label="Chore">
              <input
                name="title"
                required
                className={fieldClass}
                placeholder="Take the bins out"
              />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Repeat every (days)">
                <input
                  name="cadence_days"
                  type="number"
                  min={1}
                  max={365}
                  defaultValue={7}
                  className={fieldClass}
                />
              </Field>
              <Field label="First due">
                <input
                  name="start_on"
                  type="date"
                  defaultValue={today(tz)}
                  className={fieldClass}
                />
              </Field>
            </div>
            <Field label="Who does it">
              <select name="owner" defaultValue="rotate" className={fieldClass}>
                <option value="rotate">Rotate between us</option>
                {people.map((person) => (
                  <option key={person.id} value={person.id}>
                    Always {person.name}
                  </option>
                ))}
              </select>
            </Field>
            <SubmitButton>Add chore</SubmitButton>
          </ActionForm>
        </Disclosure>
      </div>
    </>
  );
}
