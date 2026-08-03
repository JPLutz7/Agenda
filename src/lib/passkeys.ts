import "server-only";
import crypto from "node:crypto";
import { cookies } from "next/headers";
import { headers } from "next/headers";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { db } from "./db";
import { pushContact } from "./contact";

/**
 * Face ID, by way of passkeys.
 *
 * The web can't ask for Face ID. What it can do is ask the phone to vouch for
 * its owner — WebAuthn with `userVerification: "required"` — and on an iPhone
 * the phone answers that with Face ID. So the app never sees a face, a
 * fingerprint, or anything that could leak: it sees a signature that only that
 * phone's secure enclave can produce, and only produces after the phone is
 * satisfied about who's holding it.
 *
 * Two ceremonies, both the same shape: the server issues a random challenge,
 * the phone signs it, the server checks the signature against the public key
 * it stored at registration. The private half never leaves the phone.
 *
 * What this is protecting against is worth being clear about, because it isn't
 * the internet: it's the flatmate, the friend, or the finder who is holding an
 * already-unlocked phone. The passcode is what proves the *device* is allowed;
 * this is what proves the *person* is, every time the app is opened.
 */

/** How long a challenge is good for. Long enough to look at the phone. */
const CHALLENGE_TTL_MS = 5 * 60_000;
const CHALLENGE_COOKIE = "agenda_webauthn_challenge";

export type PasskeyRow = {
  id: number;
  credential_id: string;
  public_key: string;
  counter: number;
  transports: string | null;
  label: string | null;
  person_id: number | null;
  created_at: string;
  last_used_at: string | null;
};

/** A row as Setup lists it, with the owner's name joined on. */
export type PasskeyListing = PasskeyRow & { person_name: string | null };

/**
 * The domain the passkey is bound to, and the origin it may be used from.
 *
 * A passkey is tied to one site by design — this is what makes it unphishable,
 * and it's also what makes it fussy: register on agenda-nd.fly.dev and the
 * credential is useless anywhere else, which is the point.
 *
 * Taken from the request rather than hard-coded, so this works unchanged on
 * localhost, on the Fly host, and on any future domain. The deployed address
 * is only the fallback for a call with no request headers behind it.
 */
async function relyingParty(): Promise<{ id: string; origin: string }> {
  const head = await headers();
  const host = head.get("host");
  if (!host) {
    const url = new URL(pushContact());
    return { id: url.hostname, origin: url.origin };
  }
  // A forwarded protocol is what Fly's proxy sets; local development is http.
  const proto =
    head.get("x-forwarded-proto") ??
    (host.startsWith("127.0.0.1") || host.startsWith("localhost")
      ? "http"
      : "https");
  return { id: host.split(":")[0], origin: `${proto}://${host}` };
}

/* ------------------------------------------------------------- the table */

export function listPasskeys(): PasskeyListing[] {
  return db
    .prepare<[], PasskeyListing>(
      `SELECT p.*, pe.name AS person_name
         FROM passkeys p
         LEFT JOIN people pe ON pe.id = p.person_id
        ORDER BY p.created_at`,
    )
    .all();
}

export function passkeyCount(): number {
  return db
    .prepare<[], { n: number }>("SELECT COUNT(*) AS n FROM passkeys")
    .get()!.n;
}

export function getPasskey(credentialId: string): PasskeyRow | null {
  return (
    db
      .prepare<[string], PasskeyRow>(
        "SELECT * FROM passkeys WHERE credential_id = ?",
      )
      .get(credentialId) ?? null
  );
}

export function deletePasskey(id: number): void {
  db.prepare("DELETE FROM passkeys WHERE id = ?").run(id);
}

/* -------------------------------------------------------- the challenge */

/**
 * Kept in a signed, httpOnly cookie rather than in the database.
 *
 * A challenge belongs to one browser mid-ceremony, not to the dorm, and it is
 * dead in five minutes. Storing it server-side would mean a table to clean up
 * and a way for one phone's ceremony to collide with the other's; signing it
 * means the server can trust a value it didn't keep.
 */
function challengeSecret(): string {
  return process.env.AGENDA_SECRET ?? "agenda-webauthn-challenge";
}

function sign(value: string): string {
  return crypto
    .createHmac("sha256", challengeSecret())
    .update(value)
    .digest("hex");
}

async function rememberChallenge(challenge: string): Promise<void> {
  const jar = await cookies();
  const payload = `${challenge}.${Date.now()}`;
  jar.set(CHALLENGE_COOKIE, `${payload}.${sign(payload)}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: CHALLENGE_TTL_MS / 1000,
  });
}

/**
 * Reads the challenge back and spends it: a challenge that can be used twice
 * is a replay waiting to happen, so it's deleted whether or not it verifies.
 */
async function takeChallenge(): Promise<string | null> {
  const jar = await cookies();
  const raw = jar.get(CHALLENGE_COOKIE)?.value;
  jar.delete(CHALLENGE_COOKIE);
  if (!raw) return null;

  const parts = raw.split(".");
  if (parts.length !== 3) return null;
  const [challenge, issued, signature] = parts;

  const expected = sign(`${challenge}.${issued}`);
  const a = Buffer.from(signature, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  const at = Number(issued);
  if (!Number.isFinite(at) || Date.now() - at > CHALLENGE_TTL_MS) return null;
  return challenge;
}

/* ------------------------------------------------------- registering one */

export async function registrationOptions(label: string) {
  const rp = await relyingParty();
  const existing = listPasskeys();

  const options = await generateRegistrationOptions({
    rpName: "Agenda",
    rpID: rp.id,
    // One "user" because there is one dorm: the app has a single shared login,
    // and a passkey here says "this phone is allowed in", not "this is Joao".
    userID: new TextEncoder().encode("dorm"),
    userName: "Agenda",
    userDisplayName: label || "Agenda",
    attestationType: "none",
    // Nothing here is worth a security key on a keyring: it has to be the
    // phone in your hand, and it has to check whose hand that is.
    authenticatorSelection: {
      authenticatorAttachment: "platform",
      residentKey: "preferred",
      userVerification: "required",
    },
    // So a phone that's already registered offers to update rather than
    // silently making a second credential for itself.
    excludeCredentials: existing.map((key) => ({ id: key.credential_id })),
  });

  await rememberChallenge(options.challenge);
  return options;
}

export async function saveRegistration(
  response: RegistrationResponseJSON,
  label: string,
  personId: number | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const challenge = await takeChallenge();
  if (!challenge) return { ok: false, error: "That took too long — try again." };

  const rp = await relyingParty();
  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.id,
      requireUserVerification: true,
    });
  } catch {
    return { ok: false, error: "This phone couldn't be registered." };
  }

  if (!verification.verified || !verification.registrationInfo) {
    return { ok: false, error: "This phone couldn't be registered." };
  }

  const { credential } = verification.registrationInfo;
  db.prepare(
    `INSERT INTO passkeys (credential_id, public_key, counter, transports, label, person_id)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(credential_id) DO UPDATE SET
       public_key = excluded.public_key,
       counter    = excluded.counter,
       label      = excluded.label,
       person_id  = excluded.person_id`,
  ).run(
    credential.id,
    Buffer.from(credential.publicKey).toString("base64url"),
    credential.counter,
    JSON.stringify(credential.transports ?? []),
    label || null,
    personId,
  );

  return { ok: true };
}

/* ---------------------------------------------------------- unlocking it */

export async function authenticationOptions(credentialId?: string) {
  const rp = await relyingParty();
  const keys = credentialId
    ? [getPasskey(credentialId)].filter((k) => k !== null)
    : listPasskeys();

  const options = await generateAuthenticationOptions({
    rpID: rp.id,
    // Naming the credentials this device holds is what makes iOS offer the
    // right one immediately instead of a chooser.
    allowCredentials: keys.map((key) => ({
      id: key.credential_id,
      transports: safeTransports(key.transports),
    })),
    userVerification: "required",
  });

  await rememberChallenge(options.challenge);
  return options;
}

export async function verifyAssertion(
  response: AuthenticationResponseJSON,
): Promise<{ ok: true; passkey: PasskeyRow } | { ok: false; error: string }> {
  const challenge = await takeChallenge();
  if (!challenge) return { ok: false, error: "That took too long — try again." };

  const passkey = getPasskey(response.id);
  if (!passkey) return { ok: false, error: "This phone isn't registered." };

  const rp = await relyingParty();
  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.id,
      // The whole point: a signature the phone produced without checking who
      // was holding it would prove the device and not the person.
      requireUserVerification: true,
      credential: {
        id: passkey.credential_id,
        publicKey: new Uint8Array(Buffer.from(passkey.public_key, "base64url")),
        counter: passkey.counter,
        transports: safeTransports(passkey.transports),
      },
    });
  } catch {
    return { ok: false, error: "That didn't match. Try again." };
  }

  if (!verification.verified) return { ok: false, error: "That didn't match." };

  db.prepare(
    "UPDATE passkeys SET counter = ?, last_used_at = datetime('now') WHERE id = ?",
  ).run(verification.authenticationInfo.newCounter, passkey.id);

  return { ok: true, passkey };
}

function safeTransports(raw: string | null) {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : undefined;
  } catch {
    return undefined;
  }
}
