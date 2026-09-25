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

// Checks a code typed by the seller (pickup) or courier (delivery) against the order.
// Must run inside a transaction with the order row locked. On a wrong code the failed
// try is counted; the caller must COMMIT so the count sticks.
export type HandoverCheck =
  | { ok: true }
  | { ok: false; status: number; body: { error: string; fields?: Record<string, string> }; countedAttempt: boolean };

export async function checkHandoverCode(
  client: import("pg").PoolClient,
  order: { id: number; handover_code_hash: string | null; code_expired: boolean; handover_failed_attempts: number },
  rawCode: unknown
): Promise<HandoverCheck> {
  const code = typeof rawCode === "string" ? rawCode.replace(/\s/g, "") : "";
  if (!order.handover_code_hash || order.code_expired) {
    return {
      ok: false,
      status: 422,
      body: { error: "Ask the customer to open their order and show a new code." },
      countedAttempt: false,
    };
  }
  if (order.handover_failed_attempts >= HANDOVER_MAX_ATTEMPTS) {
    return {
      ok: false,
      status: 423,
      body: { error: "Too many wrong codes. The customer needs to show a new code." },
      countedAttempt: false,
    };
  }
  if (!/^\d{6}$/.test(code) || !handoverCodeMatches(order.id, code, order.handover_code_hash)) {
    await client.query("UPDATE orders SET handover_failed_attempts = handover_failed_attempts + 1 WHERE id = $1", [order.id]);
    const left = HANDOVER_MAX_ATTEMPTS - order.handover_failed_attempts - 1;
    return {
      ok: false,
      status: 422,
      body: {
        error:
          left > 0
            ? `That code is not right. ${left} ${left === 1 ? "try" : "tries"} left.`
            : "That code is not right. The customer needs a new code.",
        fields: { code: "Wrong code." },
      },
      countedAttempt: true,
    };
  }
  return { ok: true };
}
