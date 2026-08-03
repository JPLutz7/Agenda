"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";
import {
  deviceIsLocked,
  endSession,
  isSignedIn,
  lockDevice,
  relock,
  unlockDevice,
} from "./auth";
import {
  authenticationOptions,
  deletePasskey,
  listPasskeys,
  passkeyCount,
  registrationOptions,
  saveRegistration,
  verifyAssertion,
} from "./passkeys";

/**
 * The two Face ID ceremonies, as server actions.
 *
 * They're in their own file rather than in `actions.ts` because they are the
 * only actions that are part of getting *in*: everything there assumes you
 * already are, and `finishUnlock` by definition runs when you aren't.
 *
 * Each returns a report rather than throwing. An exception in a server action
 * is an opaque error page, and an opaque error page on the unlock screen is a
 * phone that can't be used.
 */

async function requireSession() {
  if (!(await isSignedIn())) redirect("/login");
}

/* ------------------------------------------------------- turning it on */

export async function beginPasskeyRegistration(label: string) {
  await requireSession();
  return registrationOptions(label);
}

export async function finishPasskeyRegistration(
  response: RegistrationResponseJSON,
  label: string,
  personId: number | null,
): Promise<{ ok: boolean; error?: string }> {
  await requireSession();
  const result = await saveRegistration(response, label, personId);
  if (!result.ok) return { ok: false, error: result.error };

  // Registering *is* the request to be locked: the phone you set this up on is
  // the phone you want asked. Doing it in one step means there's no state
  // where a passkey exists but nothing uses it.
  await lockDevice(true);
  // And the phone is unlocked right now — the face check just happened, and
  // demanding a second one to get back to Setup would be theatre.
  await unlockDevice();
  revalidatePath("/settings");
  return { ok: true };
}

/* --------------------------------------------------------- turning it off */

export async function stopLockingThisPhone(): Promise<void> {
  await requireSession();
  await lockDevice(false);
  revalidatePath("/settings");
}

export async function removePasskey(id: number): Promise<void> {
  await requireSession();
  deletePasskey(id);
  // The last passkey going means nothing can satisfy the lock any more. The
  // guard already refuses to strand a device in that state; clearing the
  // cookie here makes it true rather than merely survivable.
  if (passkeyCount() === 0) await lockDevice(false);
  revalidatePath("/settings");
}

/* ------------------------------------------------------------- unlocking */

export async function beginUnlock() {
  await requireSession();
  return authenticationOptions();
}

export async function finishUnlock(
  response: AuthenticationResponseJSON,
): Promise<{ ok: boolean; error?: string }> {
  await requireSession();
  const result = await verifyAssertion(response);
  if (!result.ok) return { ok: false, error: result.error };
  await unlockDevice();
  return { ok: true };
}

/**
 * The way out of a lock that can't be satisfied — a broken camera, a phone
 * whose passkey was deleted from the other one, a face the phone no longer
 * recognises.
 *
 * It signs the device out rather than letting it in. The passcode still has to
 * be typed, so this is not a way past the lock for somebody holding your
 * unlocked phone: it's a way back to the front door. Typing the passcode also
 * clears the lock on this device, which is the only way a phone whose Face ID
 * is genuinely broken could ever be used again.
 */
export async function escapeToPasscode(): Promise<void> {
  await lockDevice(false);
  await endSession();
  redirect("/login");
}

/**
 * Put the app away.
 *
 * Called when the app is hidden — switched away from, screen off, swiped up.
 * This is what turns a two-minute token into "every time": the token's own
 * expiry is only the backstop for when this can't run.
 */
export async function relockNow(): Promise<void> {
  if (await deviceIsLocked()) await relock();
}

export async function passkeysForSettings() {
  await requireSession();
  return { keys: listPasskeys(), locked: await deviceIsLocked() };
}
