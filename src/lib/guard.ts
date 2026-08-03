import "server-only";
import { redirect } from "next/navigation";
import { deviceIsLocked, isSignedIn, isUnlocked } from "./auth";
import { passkeyCount } from "./passkeys";

/**
 * Every page behind the passcode starts with this.
 *
 * Two gates, and they answer different questions. The passcode says *this
 * device is allowed here*, once, and then for sixty days. Face ID says *and
 * this is one of the people who lives here*, every single time the app is
 * opened on a phone that asked to be locked.
 *
 * The order matters: a phone that has been signed out has nothing to unlock,
 * so the passcode is checked first.
 */
export async function requireSignedIn(): Promise<void> {
  if (!(await isSignedIn())) redirect("/login");

  // Locked is a per-phone setting, so a laptop that never registered a
  // passkey never sees this. The passkey count is the safety catch: if every
  // passkey has been deleted — a lost phone cleared from Setup — a stale lock
  // cookie must not strand this device at a screen it can never get past.
  if ((await deviceIsLocked()) && passkeyCount() > 0 && !(await isUnlocked())) {
    redirect("/unlock");
  }
}
