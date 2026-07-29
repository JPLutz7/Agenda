"use client";

import { useFormStatus } from "react-dom";

/**
 * Pull now, rather than waiting.
 *
 * The app already refreshes itself — on a timer, on foreground, on focus — but
 * none of that is visible, and an installed home-screen app has no reload
 * button of its own to fall back on. This is the one that answers "is it
 * actually up to date?" without anyone having to trust that it is.
 *
 * It has to live inside the <form> whose action does the syncing: useFormStatus
 * reports on the nearest enclosing form, which is what turns the icon while the
 * pull is in flight.
 */
export function RefreshButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      aria-label={pending ? "Refreshing" : "Refresh"}
      title="Refresh"
      className="-m-1 rounded-lg p-2 text-muted transition-colors hover:text-foreground disabled:text-accent"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={`h-5 w-5 ${pending ? "animate-spin" : ""}`}
        aria-hidden="true"
      >
        <path d="M23 4v6h-6" />
        <path d="M1 20v-6h6" />
        <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10" />
        <path d="M3.51 15a9 9 0 0 0 14.85 3.36L23 14" />
      </svg>
    </button>
  );
}
