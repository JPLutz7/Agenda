import "server-only";
import crypto from "node:crypto";

/**
 * Encryption for stored iCloud credentials.
 *
 * An app-specific password is not a scoped API token — it grants access to
 * that Apple ID's calendar data. It is the most sensitive thing this app
 * holds, so it is never stored in the clear and never sent back to the
 * browser once saved.
 *
 * The key comes from AGENDA_SECRET in the environment, deliberately *not*
 * from the database. The ciphertext lives in the database, so a key stored
 * beside it would be decoration rather than encryption — anyone with a copy
 * of the file would have both halves.
 */

const ALGORITHM = "aes-256-gcm";
/** Fixed salt: the input is a high-entropy secret, not a user password. */
const KEY_SALT = "agenda.caldav.v1";

export class MissingEncryptionKey extends Error {
  constructor() {
    super(
      "AGENDA_SECRET is not set, so iCloud passwords can't be encrypted. " +
        "Set it before connecting an account — on Fly: " +
        "fly secrets set AGENDA_SECRET=$(openssl rand -hex 32)",
    );
    this.name = "MissingEncryptionKey";
  }
}

export function canStoreSecrets(): boolean {
  return Boolean(process.env.AGENDA_SECRET);
}

function key(): Buffer {
  const secret = process.env.AGENDA_SECRET;
  if (!secret) throw new MissingEncryptionKey();
  return crypto.scryptSync(secret, KEY_SALT, 32);
}

/** Returns "iv.authTag.ciphertext", all base64. */
export function encryptSecret(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key(), iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return [
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    encrypted.toString("base64"),
  ].join(".");
}

export function decryptSecret(stored: string): string {
  const [ivB64, tagB64, dataB64] = stored.split(".");
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error("Stored credential is malformed.");
  }
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    key(),
    Buffer.from(ivB64, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  // A wrong key fails here on the auth tag rather than returning garbage.
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
