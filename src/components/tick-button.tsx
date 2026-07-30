"use client";

import { useFormStatus } from "react-dom";
import { Check } from "lucide-react";

/**
 * An empty circle that fills in when you press it.
 *
 * A submit button wearing the one shape everybody already reads as "not done
 * yet". The tick is drawn but invisible until hover or submission, so the
 * control is quiet while the row is unread and unmistakable the moment it's
 * being used — the press has to feel like it landed, because the server round
 * trip that removes the row takes a moment.
 */
export function TickButton({ label }: { label: string }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      aria-label={label}
      title={label}
      className={`group inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition ${
        pending
          ? "border-accent bg-accent text-white"
          : "border-border text-transparent hover:border-accent hover:text-accent"
      }`}
    >
      <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden="true" />
    </button>
  );
}
