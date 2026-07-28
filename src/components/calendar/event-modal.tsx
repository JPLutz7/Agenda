"use client";

import { useEffect, useRef } from "react";
import { removeHouseholdEvent } from "@/lib/actions";
import { SubmitButton } from "@/components/forms";
import type { CalEvent } from "./types";

/**
 * Full detail for one event.
 *
 * A block in the grid can only ever show a truncated title, so tapping it has
 * to lead somewhere that shows everything — time, whose it is, where.
 * Rendered as a <dialog> so the browser handles focus trapping and Escape.
 */
export function EventModal({
  event,
  onClose,
}: {
  event: CalEvent | null;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (event && !dialog.open) dialog.showModal();
    if (!event && dialog.open) dialog.close();
  }, [event]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      // Clicking the backdrop closes; clicks inside the panel stop here.
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      // m-auto centres it: the Tailwind reset zeroes the margin a <dialog>
      // would otherwise use to centre itself, pinning it to the top.
      className="m-auto w-[min(26rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-border bg-surface p-0 text-foreground backdrop:bg-black/40"
    >
      {event && (
        <div>
          <div
            className="h-1.5 w-full rounded-t-2xl"
            style={{ backgroundColor: event.color }}
          />
          <div className="p-5">
            <h2 className="text-lg font-semibold leading-snug">
              {event.summary}
            </h2>

            <dl className="mt-4 space-y-2.5 text-sm">
              <div className="flex gap-3">
                <dt className="w-20 shrink-0 text-muted">When</dt>
                <dd className="min-w-0 flex-1">
                  {event.dateLabel}
                  <br />
                  <span className="text-muted">{event.rangeLabel}</span>
                </dd>
              </div>

              {event.personName && (
                <div className="flex gap-3">
                  <dt className="w-20 shrink-0 text-muted">Whose</dt>
                  <dd className="flex min-w-0 flex-1 items-center gap-2">
                    <span
                      aria-hidden="true"
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: event.color }}
                    />
                    {event.personName}
                  </dd>
                </div>
              )}

              {event.location && (
                <div className="flex gap-3">
                  <dt className="w-20 shrink-0 text-muted">Where</dt>
                  <dd className="min-w-0 flex-1 break-words">
                    {event.location}
                  </dd>
                </div>
              )}

              <div className="flex gap-3">
                <dt className="w-20 shrink-0 text-muted">From</dt>
                <dd className="min-w-0 flex-1">
                  {event.source === "household"
                    ? "Added in this app"
                    : event.source === "chore"
                      ? "Chore rotation"
                      : "Your calendar"}
                </dd>
              </div>
            </dl>

            <div className="mt-6 flex items-center justify-between gap-3">
              {event.householdId !== null ? (
                <form action={removeHouseholdEvent.bind(null, event.householdId)}>
                  <SubmitButton variant="danger" className="px-0">
                    Delete event
                  </SubmitButton>
                </form>
              ) : event.source === "chore" ? (
                // A chore's date is owned by the rotation, so it can't be
                // edited here without the two disagreeing.
                <span className="text-xs text-muted">
                  Manage this on the Chores tab
                </span>
              ) : (
                <span className="text-xs text-muted">
                  Edit this one in your Calendar app
                </span>
              )}
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-border bg-surface-muted px-4 py-2 text-sm font-medium"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </dialog>
  );
}
