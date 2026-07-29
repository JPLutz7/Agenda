import "server-only";
import crypto from "node:crypto";
import { cookies } from "next/headers";
import { getSetting, setSetting } from "./db";

/**
 * Authentication for a household of two.
 *
 * One shared passcode, stored scrypt-hashed, exchanged for a signed cookie.
 * There are no user accounts to manage because there are no users to manage —
 * anyone who knows the passcode is one of the people who lives here.
 */

const COOKIE_NAME = "agenda_session";
const SESSION_TTL_DAYS = 60;
const PASSCODE_KEY = "passcode_hash";
const SECRET_KEY = "session_secret";

function secret(): string {
  if (process.env.AGENDA_SECRET) return process.env.AGENDA_SECRET;
  // Fall back to a generated secret so the app works with zero configuration.
  // It lives in the database, so sessions survive restarts.
  let stored = getSetting(SECRET_KEY);
  if (!stored) {
    stored = crypto.randomBytes(32).toString("hex");
    setSetting(SECRET_KEY, stored);
  }
  return stored;
}

export function isPasscodeSet(): boolean {
  return getSetting(PASSCODE_KEY) !== null;
}

export function setPasscode(passcode: string): void {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(passcode, salt, 64).toString("hex");
  setSetting(PASSCODE_KEY, `${salt}:${hash}`);
}

export function verifyPasscode(passcode: string): boolean {
  const stored = getSetting(PASSCODE_KEY);
  if (!stored) return false;
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(passcode, salt, 64);
  const expected = Buffer.from(hash, "hex");
  if (candidate.length !== expected.length) return false;
  return crypto.timingSafeEqual(candidate, expected);
}

function sign(payload: string): string {
  return crypto.createHmac("sha256", secret()).update(payload).digest("hex");
}

function issueToken(): string {
  const payload = String(Date.now());
  return `${payload}.${sign(payload)}`;
}

function tokenIsValid(token: string | undefined): boolean {
  if (!token) return false;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return false;

  const expected = sign(payload);
  const a = Buffer.from(signature, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;

  const issuedAt = Number(payload);
  if (!Number.isFinite(issuedAt)) return false;
  return Date.now() - issuedAt < SESSION_TTL_DAYS * 86_400_000;
}

export async function startSession(): Promise<void> {
  const jar = await cookies();
  jar.set(COOKIE_NAME, issueToken(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_DAYS * 86_400,
  });
}

export async function endSession(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE_NAME);
}

export async function isSignedIn(): Promise<boolean> {
  const jar = await cookies();
  return tokenIsValid(jar.get(COOKIE_NAME)?.value);
}

/**
 * Whose phone this is.
 *
 * There is one shared passcode, so the session says "somebody who lives here"
 * and nothing more. That's fine for permission and useless for "your roommate
 * added something" — which needs to know who *isn't* being told. Set when
 * notifications are turned on, since that's the one moment the app already has
 * to ask, and read back here.
 *
 * Not httpOnly-sensitive and not a permission: worst case someone re-labels
 * their own phone and gets their own notifications.
 */
const DEVICE_COOKIE = "agenda_device_person";

export async function setDevicePerson(personId: number | null): Promise<void> {
  const jar = await cookies();
  if (personId === null) {
    jar.delete(DEVICE_COOKIE);
    return;
  }
  jar.set(DEVICE_COOKIE, String(personId), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 365 * 86_400,
  });
}

export async function devicePerson(): Promise<number | null> {
  const jar = await cookies();
  const raw = jar.get(DEVICE_COOKIE)?.value;
  const id = Number(raw);
  return raw && Number.isInteger(id) && id > 0 ? id : null;
}
