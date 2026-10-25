// Sign-in with an SMS code (like WhatsApp): no passphrase for customers, sellers and couriers.
//
//   npm run test:signin
//
// Starts its own copy of the API on a spare port, in demo mode, so the API hands the code back and
// the test can "read the SMS". It creates test accounts: run `npm run db:setup` and
// `npm run db:seed` afterwards if you want a clean demo.

// Demo mode, and trust one proxy so each check can come from its own made-up IP address
// (X-Forwarded-For) - otherwise the per-address limit on failed tries would stop the test itself.
process.env.SMS_DEMO_SHOW_CODES = "true";
process.env.TRUST_PROXY = "1";

import assert from "assert/strict";
import { AddressInfo } from "net";
import { app } from "../app";
import { pool } from "../db";
import { normaliseSaPhone } from "../lib/phone";

const ORIGIN = "http://localhost:5173";
let base = "";
let passed = 0;
let ipCounter = 1;

async function call(cookie: string, path: string, body?: unknown, ip = "10.0.0.1") {
  const res = await fetch(base + path, {
    method: body ? "POST" : "GET",
    headers: { Origin: ORIGIN, Cookie: cookie, "X-Forwarded-For": ip, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null, setCookie: res.headers.get("set-cookie") };
}

async function check(name: string, fn: (ip: string) => Promise<void>) {
  await fn(`10.0.1.${ipCounter++}`);
  passed++;
  console.log(`  PASS  ${name}`);
}

// A random, unused number for each run.
const freshPhone = (prefix: string) => prefix + String(Date.now()).slice(-7);

async function main() {
  const server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  try {
    console.log("\nSMS code sign-in tests\n");
    const phone = freshPhone("073");

    await check("a number that isn't South African is refused before any SMS is sent", async (ip) => {
      const r = await call("", "/api/auth/code", { phone: "12345" }, ip);
      assert.equal(r.status, 422);
    });

    let code = "";
    await check("asking for a code sends one; only a hash of it is stored", async (ip) => {
      const r = await call("", "/api/auth/code", { phone }, ip);
      assert.equal(r.status, 200);
      code = r.data.demoCode;
      assert.match(code, /^\d{6}$/);
      const row = (await pool.query("SELECT code_hash FROM phone_codes WHERE phone = $1", [normaliseSaPhone(phone)])).rows[0];
      assert.equal(row.code_hash.length, 64);
      assert.ok(!row.code_hash.includes(code));
    });

    await check("a new code can't be asked for again within a minute (protects the SMS bill)", async (ip) => {
      const r = await call("", "/api/auth/code", { phone }, ip);
      assert.equal(r.status, 429);
    });

    await check("a wrong code is refused and says how many tries are left", async (ip) => {
      const wrong = code === "000000" ? "111111" : "000000";
      const r = await call("", "/api/auth/code/verify", { phone, code: wrong }, ip);
      assert.equal(r.status, 422);
      assert.match(r.data.error, /4 tries left/);
    });

    await check("a new number with the right code is asked for a name - nothing is created yet", async (ip) => {
      const r = await call("", "/api/auth/code/verify", { phone, code }, ip);
      assert.equal(r.status, 200);
      assert.equal(r.data.needsName, true);
      const u = await pool.query("SELECT 1 FROM users WHERE phone = $1", [normaliseSaPhone(phone)]);
      assert.equal(u.rowCount, 0);
    });

    let userId = 0;
    await check("the same code plus a name creates a customer account and signs in ('role' is ignored)", async (ip) => {
      const r = await call("", "/api/auth/code/verify", { phone, code, displayName: "Code Tester", role: "entrepreneur" }, ip);
      assert.equal(r.status, 201);
      assert.equal(r.data.user.role, "consumer");
      userId = r.data.user.id;
      const me = await call(r.setCookie!.split(";")[0], "/api/auth/me");
      assert.equal(me.data.user.id, userId);
      const u = (await pool.query("SELECT password_hash FROM users WHERE id = $1", [userId])).rows[0];
      assert.equal(u.password_hash, null, "no passphrase is stored");
    });

    await check("a code works only once", async (ip) => {
      const r = await call("", "/api/auth/code/verify", { phone, code }, ip);
      assert.equal(r.status, 422);
      assert.match(r.data.error, /expired/);
    });

    await check("next time, the same number signs in to the same account", async (ip) => {
      await pool.query("UPDATE phone_codes SET created_at = created_at - interval '2 minutes' WHERE phone = $1", [normaliseSaPhone(phone)]);
      const sent = await call("", "/api/auth/code", { phone }, ip);
      const r = await call("", "/api/auth/code/verify", { phone, code: sent.data.demoCode }, ip);
      assert.equal(r.status, 200);
      assert.equal(r.data.user.id, userId);
    });

    await check("after 5 wrong tries the code stops working, even the right one", async (ip) => {
      const other = freshPhone("074");
      const sent = await call("", "/api/auth/code", { phone: other }, ip);
      const wrong = sent.data.demoCode === "000000" ? "111111" : "000000";
      for (let i = 0; i < 5; i++) await call("", "/api/auth/code/verify", { phone: other, code: wrong }, `10.0.2.${i}`);
      const r = await call("", "/api/auth/code/verify", { phone: other, code: sent.data.demoCode }, ip);
      assert.equal(r.status, 423);
    });

    await check("an expired code is refused", async (ip) => {
      const other = freshPhone("075");
      const sent = await call("", "/api/auth/code", { phone: other }, ip);
      await pool.query("UPDATE phone_codes SET expires_at = now() - interval '1 second' WHERE phone = $1", [normaliseSaPhone(other)]);
      const r = await call("", "/api/auth/code/verify", { phone: other, code: sent.data.demoCode, displayName: "Late" }, ip);
      assert.equal(r.status, 422);
    });

    await check("support staff can't sign in with an SMS code alone", async (ip) => {
      await pool.query("DELETE FROM phone_codes WHERE phone = '+27710000004'");
      const sent = await call("", "/api/auth/code", { phone: "0710000004" }, ip);
      const r = await call("", "/api/auth/code/verify", { phone: "0710000004", code: sent.data.demoCode }, ip);
      assert.equal(r.status, 403);
    });

    await check("customers stay signed in for days; support is signed out after 30 idle minutes", async (ip) => {
      await pool.query("UPDATE phone_codes SET created_at = created_at - interval '2 minutes' WHERE phone = $1", [normaliseSaPhone(phone)]);
      const sent = await call("", "/api/auth/code", { phone }, ip);
      const customer = (await call("", "/api/auth/code/verify", { phone, code: sent.data.demoCode }, ip)).setCookie!.split(";")[0];
      const staff = (await call("", "/api/auth/login", { phone: "0710000004", passphrase: "Kuruman Oasis 2026" }, ip)).setCookie!.split(";")[0];
      // Pretend both were last used 2 hours ago.
      await pool.query(
        "UPDATE sessions SET last_seen_at = now() - interval '2 hours' WHERE user_id IN ($1, (SELECT id FROM users WHERE phone = '+27710000004'))",
        [userId]
      );
      assert.equal((await call(customer, "/api/auth/me")).data.user?.id, userId);
      assert.equal((await call(staff, "/api/auth/me")).data.user, null);
    });

    console.log(`\n${passed} checks passed.\n`);
  } finally {
    server.close();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("\nFAILED:", err);
  process.exitCode = 1;
});
