import crypto from "crypto";
import type { PoolClient } from "pg";
import { pool } from "../db";
import { sendSms } from "./sms";

// One-time SMS codes: the way customers, sellers and couriers sign in (no passphrase to remember),
// and the way anyone confirms a sensitive action such as "download my data".
// The same rules as the handover codes (lib/handover.ts): 6 digits, only a hash is stored, a short
// life, and a limited number of wrong tries.
export type CodePurpose = "sign_in" | "confirm";

export const CODE_MINUTES = 10;
export const CODE_MAX_ATTEMPTS = 5;
export const RESEND_AFTER_SECONDS = 60; // a new code at most once a minute per number...
const MAX_CODES_PER_HOUR = 5; // ...and at most 5 an hour, so nobody can run up the SMS bill

function hashCode(phone: string, purpose: CodePurpose, code: string): string {
  // Phone and purpose are mixed in, so the same 6 digits never give the same hash twice.
  return crypto.createHash("sha256").update(`${phone}:${purpose}:${code}`).digest("hex");
}

export type IssueResult = { ok: true; code: string } | { ok: false; waitSeconds: number };

// Creates a new code for this number, cancels any older unused one, and sends it by SMS.
export async function issueCode(phone: string, purpose: CodePurpose): Promise<IssueResult> {
  const recent = await pool.query(
    `SELECT count(*)::int AS last_hour,
            COALESCE(EXTRACT(EPOCH FROM (now() - max(created_at))), 1e9)::int AS seconds_since_last
       FROM phone_codes
      WHERE phone = $1 AND purpose = $2 AND created_at > now() - interval '1 hour'`,
    [phone, purpose]
  );
  const { last_hour, seconds_since_last } = recent.rows[0];
  if (seconds_since_last < RESEND_AFTER_SECONDS) return { ok: false, waitSeconds: RESEND_AFTER_SECONDS - seconds_since_last };
  if (last_hour >= MAX_CODES_PER_HOUR) return { ok: false, waitSeconds: 60 * 60 };

  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  await pool.query(
    "UPDATE phone_codes SET expires_at = now() WHERE phone = $1 AND purpose = $2 AND used_at IS NULL AND expires_at > now()",
    [phone, purpose]
  );
  await pool.query(
    `INSERT INTO phone_codes (phone, purpose, code_hash, expires_at)
     VALUES ($1, $2, $3, now() + make_interval(mins => $4))`,
    [phone, purpose, hashCode(phone, purpose, code), CODE_MINUTES]
  );
  const what = purpose === "sign_in" ? "sign-in" : "confirmation";
  await sendSms(phone, `KurumanMarketPlace ${what} code: ${code}. It works for ${CODE_MINUTES} minutes. Never share it with anyone.`);
  return { ok: true, code };
}

export type CodeCheck = { ok: true; codeId: number } | { ok: false; status: number; error: string };

// Checks a typed code against the newest unused one for this number. Must run inside a transaction
// (the code row is locked); the caller COMMITs, so a counted wrong try sticks. A right code is NOT
// used up here - call useCode() once the action it allows has really happened.
export async function checkCode(client: PoolClient, phone: string, purpose: CodePurpose, rawCode: unknown): Promise<CodeCheck> {
  const code = typeof rawCode === "string" ? rawCode.replace(/\s/g, "") : "";
  const r = await client.query(
    `SELECT id, code_hash, failed_attempts FROM phone_codes
      WHERE phone = $1 AND purpose = $2 AND used_at IS NULL AND expires_at > now()
      ORDER BY created_at DESC LIMIT 1
      FOR UPDATE`,
    [phone, purpose]
  );
  const row = r.rows[0];
  if (!row) return { ok: false, status: 422, error: "That code has expired. Ask for a new one." };
  if (row.failed_attempts >= CODE_MAX_ATTEMPTS) {
    return { ok: false, status: 423, error: "Too many wrong codes. Ask for a new one." };
  }

  const given = Buffer.from(hashCode(phone, purpose, code), "hex");
  const stored = Buffer.from(row.code_hash, "hex");
  if (!/^\d{6}$/.test(code) || !crypto.timingSafeEqual(given, stored)) {
    await client.query("UPDATE phone_codes SET failed_attempts = failed_attempts + 1 WHERE id = $1", [row.id]);
    const left = CODE_MAX_ATTEMPTS - row.failed_attempts - 1;
    return {
      ok: false,
      status: 422,
      error: left > 0 ? `That code isn't right. ${left} ${left === 1 ? "try" : "tries"} left.` : "That code isn't right. Ask for a new one.",
    };
  }
  return { ok: true, codeId: Number(row.id) };
}

export async function useCode(client: PoolClient, codeId: number): Promise<void> {
  await client.query("UPDATE phone_codes SET used_at = now() WHERE id = $1", [codeId]);
}
