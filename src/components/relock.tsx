"use client";

import { useEffect } from "react";

/**
 * Locks the app the moment it's put away.
 *
 * This is what makes the lock mean "every time you open it" rather than "every
 * two minutes". The server-side token expires on its own — that part is the
 * guarantee, and it holds with JavaScript off — but on a phone you don't close
 * apps, you swipe away from them, and the app you come back to an hour later
 * would otherwise still be open behind you.
 *
 * `visibilitychange` is the event that actually fires on iOS when you switch
 * apps or the screen locks; `pagehide` covers the tab being closed or
 * navigated away. `sendBeacon` because both of those are moments when the page
 * may not live long enough to finish a fetch — a beacon is handed to the
 * browser to deliver and survives the page that queued it.
 *
 * Rendered only on a locked device, so the laptop never sends any of this.
 */
export function Relock() {
  useEffect(() => {
    const lock = () => {
      // Only on the way out. "visible" fires on the way back in too, and
      // locking then would throw away the unlock that just happened.
      if (document.visibilityState === "visible") return;
      navigator.sendBeacon?.("/api/relock");
    };

    document.addEventListener("visibilitychange", lock);
    window.addEventListener("pagehide", lock);
    return () => {
      document.removeEventListener("visibilitychange", lock);
      window.removeEventListener("pagehide", lock);
    };
  }, []);

  return null;
}
