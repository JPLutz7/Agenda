import { NextResponse } from "next/server";
import { isSignedIn } from "@/lib/auth";
import { syncAllFeeds } from "@/lib/sync";
import { refreshWantPrices } from "@/lib/prices";
import { notifyApartmentEventsToday, notifyChoresDue } from "@/lib/push";

export const dynamic = "force-dynamic";

/**
 * Pull every feed, check prices, and send any chore reminders that are due.
 *
 * The app refreshes itself whenever someone opens it, so this is only needed
 * for the things that shouldn't wait for that. A chore reminder is the obvious
 * one: "the bins are yours today" is worth nothing if it arrives because you
 * happened to open the app, which is the moment you'd have seen it anyway.
 * Point a scheduler at this once a morning and the notification arrives on its
 * own.
 *
 *   curl -H "Authorization: Bearer $AGENDA_CRON_SECRET" https://…/api/refresh
 */
async function handle(request: Request) {
  const secret = process.env.AGENDA_CRON_SECRET;
  const authorized = secret
    ? request.headers.get("authorization") === `Bearer ${secret}`
    : await isSignedIn();

  if (!authorized) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const results = await syncAllFeeds();
  // Prices and reminders are independent of the calendars: a feed that fails
  // shouldn't mean nobody hears about the bins.
  const prices = await refreshWantPrices({ onlyStale: true }).catch(() => []);
  const notified = await notifyChoresDue().catch(() => 0);
  const events = await notifyApartmentEventsToday().catch(() => 0);

  return NextResponse.json({
    synced: results.length,
    imported: results.reduce((sum, r) => sum + r.imported, 0),
    pricesChecked: prices.length,
    choreRemindersSent: notified,
    eventRemindersSent: events,
    errors: results.filter((r) => r.error).map((r) => ({
      feed: r.label,
      error: r.error,
    })),
  });
}

export const GET = handle;
export const POST = handle;
