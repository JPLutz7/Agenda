"use client";

import { useFormStatus } from "react-dom";
import { RefreshCw } from "lucide-react";

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
      <RefreshCw
        className={`h-5 w-5 ${pending ? "animate-spin" : ""}`}
        strokeWidth={1.8}
        aria-hidden="true"
      />
    </button>
  );
}
