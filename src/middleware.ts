import { NextResponse, type NextRequest } from "next/server";

/**
 * Remembers where you were going when the lock stopped you.
 *
 * This is the one thing a page cannot do for itself: by the time a server
 * component runs, the request carries no path — measured, not assumed, and the
 * reason the first version of this landed everyone on the Today screen after a
 * face check no matter what they'd tapped. Middleware is the only place that
 * still knows the address.
 *
 * **It is not the security check.** It looks at whether two cookies are
 * *present*, and never at whether they're valid — that is `requireSignedIn`'s
 * job, on the server, with the signature and the expiry. If this file were
 * deleted tomorrow the lock would still hold; you would just always land on
 * Today. Keeping the crypto out of here means there is only one copy of it,
 * running in one runtime, rather than a second version on the edge that has to
 * agree with the first forever.
 */

/**
 * The Node runtime rather than the edge one. Nothing here needs Node — it's
 * cookies and a URL — but the edge build compiles `instrumentation.ts` for the
 * edge too, and that file's background sync reaches SQLite and web-push, which
 * have no edge equivalent. Node middleware keeps one runtime in the process
 * and one set of assumptions in the code.
 */
export const runtime = "nodejs";

const LOCK_COOKIE = "agenda_lock";
const UNLOCK_COOKIE = "agenda_unlocked";

export function middleware(request: NextRequest): NextResponse {
  const locked = request.cookies.get(LOCK_COOKIE)?.value === "1";
  const unlocked = request.cookies.has(UNLOCK_COOKIE);
  if (!locked || unlocked) return NextResponse.next();

  const url = request.nextUrl.clone();
  const intended = `${request.nextUrl.pathname}${request.nextUrl.search}`;
  url.pathname = "/unlock";
  url.search = "";
  // Only ever a path on this site. `next` is user-controllable by definition —
  // it arrives in an address bar — and "redirect wherever this says" is how
  // open redirects get built.
  if (intended !== "/" && intended.startsWith("/") && !intended.startsWith("//")) {
    url.searchParams.set("next", intended);
  }
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    /*
     * Everything except:
     *  - /unlock and /login, which have to be reachable while locked;
     *  - /api, whose only locked-relevant route is the relock beacon itself;
     *  - the service worker and the app's own static files, which a phone
     *    fetches with no user present and which give nothing away.
     */
    "/((?!unlock|login|api|_next/static|_next/image|sw.js|manifest.webmanifest|favicon|icon-|apple-touch-icon|fonts/).*)",
  ],
};
