import crypto from "crypto";

// Time-based one-time passwords (TOTP, RFC 6238) - the 6-digit codes an authenticator app
// such as Google Authenticator or Microsoft Authenticator shows. Used as the second sign-in
// step for support staff (spec FR-21 "MFA").
//
// How it works: the server and the phone share a random secret. Every 30 seconds both compute
//   HMAC-SHA1(secret, number of 30-second steps since 1970)
// and turn the result into 6 digits. Nothing is sent to the phone after set-up, so the code
// proves the person has that phone.

const STEP_SECONDS = 30;
const DIGITS = 6;
const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

// Authenticator apps expect the secret in base32 (letters A-Z and digits 2-7).
export function base32Encode(bytes: Buffer): string {
  let bits = "";
  for (const b of bytes) bits += b.toString(2).padStart(8, "0");
  let out = "";
  for (let i = 0; i + 5 <= bits.length; i += 5) out += BASE32[parseInt(bits.slice(i, i + 5), 2)];
  return out;
}

export function base32Decode(text: string): Buffer {
  let bits = "";
  for (const ch of text.replace(/[\s=]/g, "").toUpperCase()) {
    const v = BASE32.indexOf(ch);
    if (v < 0) throw new Error("Not a base32 secret");
    bits += v.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

// 20 random bytes = 160 bits, the size RFC 4226 recommends for SHA-1.
export function newTotpSecret(): string {
  return base32Encode(crypto.randomBytes(20));
}

export function currentStep(now = Date.now()): number {
  return Math.floor(now / 1000 / STEP_SECONDS);
}

// The code for one 30-second step ("dynamic truncation" from RFC 4226, section 5.3).
export function totpCode(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = crypto.createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const number = (hmac.readUInt32BE(offset) & 0x7fffffff) % 10 ** DIGITS;
  return String(number).padStart(DIGITS, "0");
}

// Accepts the current code or the one either side of it (phone clocks drift a little).
// Returns the step that matched, so the caller can refuse that step next time - a code
// someone watched you type can't be reused. Returns null if it doesn't match.
export function verifyTotp(secret: string, code: string, lastUsedStep: number | null): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const now = currentStep();
  for (const step of [now - 1, now, now + 1]) {
    if (lastUsedStep !== null && step <= lastUsedStep) continue;
    const expected = Buffer.from(totpCode(secret, step));
    if (crypto.timingSafeEqual(expected, Buffer.from(code))) return step;
  }
  return null;
}

// The link an authenticator app reads from a QR code.
export function otpauthUrl(secret: string, accountName: string): string {
  const issuer = "KurumanMarketPlace";
  const label = encodeURIComponent(`${issuer}:${accountName}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;
}
