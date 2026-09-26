import crypto from "crypto";

// Encrypts small secrets before they go into the database (e.g. a support member's
// authenticator secret). A password can be hashed because we only ever COMPARE it; an
// authenticator secret must be read back to compute codes, so it's encrypted instead.
// If someone copies the database without the key in server/.env, the secrets are useless.
//
// AES-256-GCM: a random 12-byte IV per value, and GCM's authentication tag means a
// tampered value fails to decrypt instead of producing garbage.

function key(): Buffer {
  const raw = process.env.DATA_ENCRYPTION_KEY;
  const k = raw ? Buffer.from(raw, "base64") : Buffer.alloc(0);
  if (k.length !== 32) {
    throw new Error("DATA_ENCRYPTION_KEY in server/.env must be 32 random bytes in base64 (see .env.example).");
  }
  return k;
}

// Result format: iv.tag.ciphertext, each in base64url.
export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString("base64url")).join(".");
}

export function decryptSecret(stored: string): string {
  const [iv, tag, data] = stored.split(".").map((p) => Buffer.from(p, "base64url"));
  const decipher = crypto.createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}
