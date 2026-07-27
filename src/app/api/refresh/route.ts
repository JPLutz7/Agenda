import { NextResponse } from "next/server";
import { isSignedIn } from "@/lib/auth";
import { syncAllFeeds } from "@/lib/sync";

export const dynamic = "force-dynamic";

/**
 * Pull every feed. The app already refreshes itself when someone opens it;
 * this exists so an external scheduler can keep things warm.
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
  return NextResponse.json({
    synced: results.length,
    imported: results.reduce((sum, r) => sum + r.imported, 0),
    errors: results.filter((r) => r.error).map((r) => ({
      feed: r.label,
      error: r.error,
    })),
  });
}

export const GET = handle;
export const POST = handle;
