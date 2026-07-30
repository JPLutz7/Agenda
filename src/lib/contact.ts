/**
 * Who to contact about this server's push traffic — the VAPID "subject".
 *
 * This looks like boilerplate and is not, which is why it lives in its own file
 * with no database behind it: so a test can check it without booting the app.
 *
 * **Apple rejects an invalid subject with 403 BadJwtToken and delivers
 * nothing.** `mailto:someone@localhost` — the obvious placeholder — is one of
 * the invalid ones, because localhost is not a domain anybody could reach. It
 * has to be a real `https://` address or a real email address. Google's push
 * service doesn't check, which is exactly how a placeholder shipped: every test
 * passed, both phones were registered, and nothing ever arrived.
 */

/** Where this app actually lives. Override with `AGENDA_PUBLIC_URL` if it moves. */
export const DEFAULT_CONTACT = "https://agenda-nd.fly.dev";

export function pushContact(): string {
  const set = process.env.AGENDA_PUBLIC_URL?.trim();
  return set ? set : DEFAULT_CONTACT;
}

/**
 * Apple's rule on the subject, checked before sending so the reason can be a
 * sentence on screen rather than a 403 nobody sees.
 *
 * Returns the problem, or null if it's fine. Deliberately **not** a throw: this
 * runs inside a server action, where an exception becomes an opaque error page —
 * which tells the person even less than the wrong message did.
 */
export function contactProblem(contact: string): string | null {
  // A domain with at least one dot, so single-label names — localhost, or a
  // container hostname — are refused here the way Apple refuses them there.
  const validUrl = /^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)+(\/|$)/i.test(contact);
  const validMail = /^mailto:[^\s@]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(contact);
  if (validUrl || validMail) return null;
  return (
    `The server's contact address is "${contact}", which Apple's push service ` +
    `rejects. Set AGENDA_PUBLIC_URL to this app's https:// address.`
  );
}
