"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * Keeps an installed home-screen app showing current data.
 *
 * Two things go stale in a phone web app. The obvious one is that your
 * roommate ticks something off and your copy doesn't know. The subtler one is
 * that iOS freezes a home-screen app when you switch away and hands back the
 * exact pixels you left behind — so without this, reopening the app can show
 * yesterday's agenda indefinitely, with nothing on screen suggesting it's out
 * of date.
 *
 * router.refresh() re-fetches the server components in place. It keeps scroll
 * position and client state, and it re-runs the iCloud staleness check on the
 * server, so a foregrounded app also pulls fresh calendar data.
 */

const POLL_MS = 45_000;
/** Don't hammer the server when several triggers fire at once. */
const MIN_GAP_MS = 5_000;

export function LiveRefresh() {
  const router = useRouter();
  const lastRefresh = useRef(0);

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== "visible") return;

      // Refreshing mid-sentence would re-render the form under the keyboard.
      // Whoever is typing is about to submit anyway, which refreshes for us.
      const active = document.activeElement;
      if (
        active instanceof HTMLElement &&
        ["INPUT", "TEXTAREA", "SELECT"].includes(active.tagName)
      ) {
        return;
      }

      const now = Date.now();
      if (now - lastRefresh.current < MIN_GAP_MS) return;
      lastRefresh.current = now;
      router.refresh();
    };

    const onVisibilityChange = () => refresh();
    const onFocus = () => refresh();
    const onOnline = () => refresh();
    // Safari restores from the back/forward cache without re-running anything;
    // `persisted` marks exactly that case.
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) refresh();
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onOnline);
    window.addEventListener("pageshow", onPageShow);
    const timer = setInterval(refresh, POLL_MS);

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("pageshow", onPageShow);
      clearInterval(timer);
    };
  }, [router]);

  return null;
}
