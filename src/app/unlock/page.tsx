import { redirect } from "next/navigation";
import { deviceIsLocked, isSignedIn, isUnlocked } from "@/lib/auth";
import { passkeyCount } from "@/lib/passkeys";
import { Unlock } from "@/components/unlock";

export const dynamic = "force-dynamic";

/**
 * The lock screen.
 *
 * Deliberately not part of the app's chrome: no tab bar, no header, nothing
 * underneath. The page you asked for was never rendered, so there is nothing
 * here to read over the top of.
 */
export default async function UnlockPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  if (!(await isSignedIn())) redirect("/login");
  // Nothing to unlock: this phone was never locked, or it already is.
  if (!(await deviceIsLocked())) redirect("/");
  if (await isUnlocked()) redirect("/");
  // A lock with nothing left to open it — the last passkey was deleted from
  // the other phone. Straight back into the app would bounce off the
  // middleware and come back here forever, so the stale cookie has to be
  // cleared first, and only a route handler can do that.
  if (passkeyCount() === 0) redirect("/api/lock-off");

  return <Unlock destination={destination((await searchParams).next)} />;
}

/**
 * Where to go once the face has been checked — put here by the middleware,
 * which is the only part of the request that still knew the address.
 *
 * Checked again rather than trusted. It arrives in the address bar, so it is
 * whatever anyone cares to type, and "send the user wherever this string says"
 * is how open redirects are built. A single leading slash, and nothing that
 * could be read as a host.
 */
function destination(next: string | undefined): string {
  if (!next) return "/";
  if (!next.startsWith("/") || next.startsWith("//")) return "/";
  if (next.startsWith("/unlock") || next.startsWith("/login")) return "/";
  return next;
}
