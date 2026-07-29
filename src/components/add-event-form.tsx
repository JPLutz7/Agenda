"use client";

import { useEffect, useRef, useState } from "react";
import { addHouseholdEvent, updateHouseholdEvent } from "@/lib/actions";
import type { Person, WritableCalendarOption } from "@/lib/data";
import type { EditableEvent } from "@/components/calendar/types";
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

export type AddEventOptions = {
  people: Person[];
  calendars: WritableCalendarOption[];
  defaultCalendarId: number | null;
};

/**
 * The fields themselves, shared by the button on the page and the dialog the
 * calendar opens on a double-click.
 *
 * The end time follows the start rather than having to be typed: picking 7:00
 * fills in 7:30, and moving the start moves the end with it, keeping whatever
 * length was set. All-day is its own toggle instead of the old "leave the
 * times blank", which nobody would guess.
 *
 * The destination calendar is chosen per event. Setup's choice arrives as
 * `defaultCalendarId` and is only the pre-selection — with no iCloud account
 * connected there is nowhere to send it, so the picker stays hidden and the
 * event simply lives in the app.
 */
export function EventFields({
  people,
  calendars,
  defaultCalendarId,
  defaultDate,
  defaultStartTime = "",
  autoFocus = false,
  submitLabel = "Add to calendar",
  existing,
  onDone,
}: AddEventOptions & {
  defaultDate: string;
  /** 'HH:MM' when the time is already known, e.g. where the grid was tapped. */
  defaultStartTime?: string;
  autoFocus?: boolean;
  submitLabel?: string;
  /** Set to edit an event in place instead of creating a new one. */
  existing?: EditableEvent;
  onDone?: () => void;
}) {
  const [allDay, setAllDay] = useState(existing?.allDay ?? false);
  const [start, setStart] = useState(existing?.startTime ?? defaultStartTime);
  const [end, setEnd] = useState(
    existing?.endTime ??
      (defaultStartTime ? shiftTime(defaultStartTime, DEFAULT_MINUTES) : ""),
  );
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus) titleRef.current?.focus();
  }, [autoFocus]);

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

  // One person's calendars need no headings; two accounts do, since both are
  // likely to have a "Home".
  const accountLabels = [...new Set(calendars.map((c) => c.account_label))];

  return (
    <ActionForm
      action={existing ? updateHouseholdEvent : addHouseholdEvent}
      className="space-y-3"
      // An edit keeps what it saved on screen; only a new event clears itself
      // ready for the next one.
      resetOnSuccess={!existing}
      onSuccess={() => {
        if (!existing) {
          setAllDay(false);
          setStart("");
          setEnd("");
        }
        onDone?.();
      }}
    >
      {existing && (
        <input type="hidden" name="event_id" value={existing.id} />
      )}

      <Field label="What">
        <input
          ref={titleRef}
          name="title"
          required
          defaultValue={existing?.title ?? ""}
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
              defaultValue={existing?.date ?? defaultDate}
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
              required
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
        <input
          name="notes"
          defaultValue={existing?.notes ?? ""}
          className={fieldClass}
          placeholder="Optional"
        />
      </Field>

      {calendars.length > 0 && (
        <Field label={existing ? "Keep it in" : "Add it to"}>
          <select
            name="calendar_id"
            defaultValue={
              existing
                ? (existing.calendarId ?? "none")
                : (defaultCalendarId ?? "none")
            }
            className={fieldClass}
          >
            <option value="none">This app only</option>
            {accountLabels.length > 1
              ? accountLabels.map((label) => (
                  <optgroup key={label} label={label}>
                    {calendars
                      .filter((c) => c.account_label === label)
                      .map((calendar) => (
                        <option key={calendar.id} value={calendar.id}>
                          {calendar.display_name}
                        </option>
                      ))}
                  </optgroup>
                ))
              : calendars.map((calendar) => (
                  <option key={calendar.id} value={calendar.id}>
                    {calendar.display_name}
                  </option>
                ))}
          </select>
        </Field>
      )}

      {people.length > 0 && (
        <input type="hidden" name="created_by" value={people[0].id} />
      )}
      <SubmitButton>{submitLabel}</SubmitButton>
    </ActionForm>
  );
}

/** Adding something to the apartment calendar, from a page. */
export function AddHouseholdEventForm({
  defaultDate,
  ...options
}: AddEventOptions & { defaultDate: string }) {
  return (
    <Disclosure summary="Add something to the apartment calendar">
      <EventFields {...options} defaultDate={defaultDate} />
    </Disclosure>
  );
}

/**
 * The same form as a dialog, for double-clicking a spot on the calendar.
 *
 * The day and the time double-clicked arrive already filled in, which is the
 * whole point — the alternative is retyping what you just pointed at. Keyed on
 * both in the calendar so a second double-click somewhere else starts fresh
 * rather than keeping the first spot's time.
 */
export function AddEventDialog({
  open,
  date,
  time,
  dateLabel,
  onClose,
  ...options
}: AddEventOptions & {
  open: boolean;
  date: string;
  /** 'HH:MM', or null when the day was picked without a time. */
  time: string | null;
  dateLabel: string;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      // m-auto centres it: the Tailwind reset zeroes the margin a <dialog>
      // would otherwise use to centre itself, pinning it to the top.
      className="m-auto w-[min(26rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-border bg-surface p-0 text-foreground backdrop:bg-black/40"
    >
      {open && (
        <div className="p-5">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold leading-snug">New event</h2>
              <p className="mt-0.5 text-xs text-muted">{dateLabel}</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded-lg border border-border bg-surface-muted px-2 py-1 text-sm"
            >
              ✕
            </button>
          </div>
          <EventFields
            {...options}
            defaultDate={date}
            defaultStartTime={time ?? ""}
            autoFocus
            submitLabel="Add event"
            onDone={onClose}
          />
        </div>
      )}
    </dialog>
  );
}
