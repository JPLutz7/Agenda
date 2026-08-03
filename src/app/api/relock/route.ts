import { NextResponse } from "next/server";
import { deviceIsLocked, relock } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Lock the app again, called the instant it's put away.
 *
 * A route handler rather than a server action because of how it's called:
 * `navigator.sendBeacon`, from a page that is already being hidden. A beacon
 * is queued by the browser and delivered whether or not the page survives the
 * next moment — which is exactly the moment a server action, a fetch, or any
 * promise the page is holding may never get to run.
 *
 * Safe to call with nothing to do: an unlocked-anyway device answers 204 the
 * same as a locked one, so the client never has to know which it is.
 */
export async function POST(): Promise<NextResponse> {
  if (await deviceIsLocked()) await relock();
  return new NextResponse(null, { status: 204 });
}
