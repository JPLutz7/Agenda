import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { isSignedIn } from "@/lib/auth";
import { passkeyCount } from "@/lib/passkeys";

export const dynamic = "force-dynamic";

/**
 * Clears a lock that nothing can open any more, then gets out of the way.
 *
 * This exists because of a loop that a browser found and reading the code
 * didn't: delete the last passkey from the other phone, and this one still
 * carries the cookie saying "ask for Face ID". The middleware sent it to the
 * lock screen; the lock screen saw there was no key left to ask with and sent
 * it back to the app; the middleware sent it to the lock screen. The phone
 * never rendered anything again.
 *
 * A page cannot fix it, because a server component may not set cookies — only
 * a route handler or an action can. Hence this: the one place that can hand
 * the browser a response which both clears the cookie and moves on.
 *
 * **It refuses while any passkey exists.** Otherwise it would be a link that
 * turns the lock off, which is precisely what the lock is there to prevent —
 * and a link is something a phone will happily follow on its own.
 */
export async function GET(): Promise<NextResponse> {
  if (!(await isSignedIn())) return to("/login");
  if (passkeyCount() > 0) return to("/unlock");

  const jar = await cookies();
  jar.delete("agenda_lock");
  jar.delete("agenda_unlocked");
  return to("/");
}

/**
 * A redirect to a path on this same site, said as a path.
 *
 * `NextResponse.redirect` wants an absolute address, and the obvious source
 * for one — `request.url` — is the address the *server* was reached on, which
 * behind a proxy is not the address the browser used. It sent the phone from
 * localhost to 0.0.0.0, a different origin as far as cookies are concerned, so
 * the session didn't travel and a phone clearing a stale lock landed on the
 * sign-in screen instead. Found by watching the responses, not by reading it.
 *
 * A relative Location has been legal since RFC 7231 and every browser resolves
 * it against the address it actually asked for — which is the one that has the
 * cookies on it.
 */
function to(path: string): NextResponse {
  return new NextResponse(null, { status: 303, headers: { Location: path } });
}
