"use client";

import { useState } from "react";
import { addHouseholdEvent } from "@/lib/actions";
import type { Person } from "@/lib/data";
import {
  ActionForm,
  Disclosure,
  Field,
  SubmitButton,
  fieldClass,
} from "@/components/forms";

/** Default length of a new event. */
const DEFAULT_MINUTES = 30;

function shiftTime(time: string, minutes: number): string {
  const [h, m] = time.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return "";
  const total = (h * 60 + m + minutes + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(
    total % 60,
  ).padStart(2, "0")}`;
}

/**
 * Adding something to the apartment calendar.
 *
 * The end time follows the start rather than having to be typed: picking 7:00
 * fills in 7:30, and moving the start moves the end with it, keeping whatever
 * length was set. All-day is its own toggle instead of the old "leave the
 * times blank", which nobody would guess.
 */
export function AddHouseholdEventForm({
  people,
  defaultDate,
}: {
  people: Person[];
  defaultDate: string;
}) {
  const [allDay, setAllDay] = useState(false);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");

  const onStartChange = (value: string) => {
    if (!value) {
      setStart("");
      return;
    }
    // Keep the length the user already chose; default to 30 minutes.
    const previous =
      start && end
        ? (Number(end.slice(0, 2)) * 60 +
            Number(end.slice(3)) -
            (Number(start.slice(0, 2)) * 60 + Number(start.slice(3))) +
            1440) %
          1440
        : DEFAULT_MINUTES;
    setStart(value);
    setEnd(shiftTime(value, previous || DEFAULT_MINUTES));
  };

  return (
    <Disclosure summary="Add something to the apartment calendar">
      <ActionForm
        action={addHouseholdEvent}
        className="space-y-3"
        resetOnSuccess
        onSuccess={() => {
          setAllDay(false);
          setStart("");
          setEnd("");
        }}
      >
        <Field label="What">
          <input
            name="title"
            required
            className={fieldClass}
            placeholder="Landlord inspection"
          />
        </Field>

        <div className="flex gap-2">
          <div className="flex-1">
            <Field label="Date">
              <input
                name="date"
                type="date"
                required
                defaultValue={defaultDate}
                className={fieldClass}
              />
            </Field>
          </div>
          <div className="flex items-end">
            <button
              type="button"
              onClick={() => setAllDay((v) => !v)}
              aria-pressed={allDay}
              className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                allDay
                  ? "border-accent bg-accent text-white"
                  : "border-border bg-surface-muted text-foreground"
              }`}
            >
              All day
            </button>
          </div>
        </div>

        {/* The server decides from this, not from whether times are blank. */}
        <input type="hidden" name="all_day" value={allDay ? "1" : "0"} />

        {!allDay && (
          <div className="grid grid-cols-2 gap-2">
            <Field label="Start">
              <input
                name="start_time"
                type="time"
                value={start}
                onChange={(e) => onStartChange(e.target.value)}
                className={fieldClass}
              />
            </Field>
            <Field label="End">
              <input
                name="end_time"
                type="time"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                className={fieldClass}
              />
            </Field>
          </div>
        )}

        <Field label="Notes">
          <input name="notes" className={fieldClass} placeholder="Optional" />
        </Field>

        {people.length > 0 && (
          <input type="hidden" name="created_by" value={people[0].id} />
        )}
        <SubmitButton>Add to calendar</SubmitButton>
      </ActionForm>
    </Disclosure>
  );
}
