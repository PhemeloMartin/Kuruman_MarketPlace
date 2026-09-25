import crypto from "crypto";

// One-time handover codes (spec FR-13, section 7.3): 6 digits, valid 15 minutes,
// at most 5 wrong attempts. Only a hash is stored; the order id is mixed in so the
// same code on two orders never produces the same hash.
export const HANDOVER_CODE_MINUTES = 15;
export const HANDOVER_MAX_ATTEMPTS = 5;

export function newHandoverCode(): string {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
}

export function hashHandoverCode(orderId: number, code: string): string {
  return crypto.createHash("sha256").update(`${orderId}:${code}`).digest("hex");
}

export function handoverCodeMatches(orderId: number, code: string, storedHash: string): boolean {
  const given = Buffer.from(hashHandoverCode(orderId, code.trim()), "hex");
  const stored = Buffer.from(storedHash, "hex");
  // Constant-time comparison, so response timing gives nothing away.
  return given.length === stored.length && crypto.timingSafeEqual(given, stored);
}
