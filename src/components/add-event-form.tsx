import { addHouseholdEvent } from "@/lib/actions";
import type { Person } from "@/lib/data";
import {
  ActionForm,
  Disclosure,
  Field,
  SubmitButton,
  fieldClass,
} from "@/components/forms";

/**
 * The iCloud feeds are read-only, so anything that belongs to the apartment
 * rather than to one person gets added here instead.
 */
export function AddHouseholdEventForm({
  people,
  defaultDate,
}: {
  people: Person[];
  defaultDate: string;
}) {
  return (
    <Disclosure summary="Add something to the apartment calendar">
      <ActionForm action={addHouseholdEvent} className="space-y-3" resetOnSuccess>
        <Field label="What">
          <input
            name="title"
            required
            className={fieldClass}
            placeholder="Landlord inspection"
          />
        </Field>
        <div className="grid grid-cols-3 gap-2">
          <Field label="Date">
            <input
              name="date"
              type="date"
              required
              defaultValue={defaultDate}
              className={fieldClass}
            />
          </Field>
          <Field label="Start">
            <input name="start_time" type="time" className={fieldClass} />
          </Field>
          <Field label="End">
            <input name="end_time" type="time" className={fieldClass} />
          </Field>
        </div>
        <p className="text-xs text-muted">
          Leave the times blank for an all-day event.
        </p>
        <Field label="Notes">
          <input
            name="notes"
            className={fieldClass}
            placeholder="Optional"
          />
        </Field>
        {people.length > 0 && (
          <input type="hidden" name="created_by" value={people[0].id} />
        )}
        <SubmitButton>Add to calendar</SubmitButton>
      </ActionForm>
    </Disclosure>
  );
}
