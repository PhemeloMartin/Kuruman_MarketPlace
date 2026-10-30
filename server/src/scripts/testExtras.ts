// Voice notes, the Business Directory, the WhatsApp channel post, free calls (Twilio) and real SMS (BulkSMS).
//
//   npm run test:extras
//
// Twilio and BulkSMS are NOT contacted: the test uses made-up keys, checks what we send, and plays
// Twilio's part itself (signing its request the way Twilio does). It adds data: run `npm run db:setup`
// and `npm run db:seed` afterwards.

process.env.TWILIO_ACCOUNT_SID = "ACtest";
process.env.TWILIO_AUTH_TOKEN = "test-auth-token";
process.env.TWILIO_API_KEY_SID = "SKtest";
process.env.TWILIO_API_KEY_SECRET = "test-key-secret";
process.env.TWILIO_TWIML_APP_SID = "APtest";
process.env.TWILIO_CALLER_ID = "+15005550006";
process.env.PUBLIC_APP_URL = "https://kurumanmarketplace.example";

import assert from "assert/strict";
import crypto from "crypto";
import { AddressInfo } from "net";
import { app } from "../app";
import { pool } from "../db";
import { sendSms } from "../lib/sms";
import { currentStep, totpCode } from "../lib/totp";

const ORIGIN = "http://localhost:5173";
let base = "";
let passed = 0;

async function call(cookie: string, method: string, path: string, body?: unknown, type?: string) {
  const raw = Buffer.isBuffer(body);
  const res = await fetch(base + path, {
    method,
    headers: { Origin: ORIGIN, Cookie: cookie, ...(body !== undefined ? { "Content-Type": type ?? "application/json" } : {}) },
    body: body === undefined ? undefined : raw ? new Uint8Array(body as Buffer) : typeof body === "string" ? body : JSON.stringify(body),
  });
  const buf = Buffer.from(await res.arrayBuffer());
  let data: any = null;
  try {
    data = JSON.parse(buf.toString("utf8"));
  } catch {}
  return { status: res.status, data, text: buf.toString("utf8"), headers: res.headers };
}

async function login(phone: string) {
  const r = await fetch(base + "/api/auth/login", {
    method: "POST",
    headers: { Origin: ORIGIN, "Content-Type": "application/json" },
    body: JSON.stringify({ phone, passphrase: process.env.SEED_PASSPHRASE || "Kuruman Oasis 2026" }),
  });
  assert.equal(r.status, 200, `login ${phone}`);
  return r.headers.get("set-cookie")!.split(";")[0];
}

async function check(name: string, fn: () => Promise<void>) {
  await fn();
  passed++;
  console.log(`  PASS  ${name}`);
}

// Signs a request the way Twilio does (HMAC-SHA1 of URL + sorted name/value pairs, base64).
function twilioSign(url: string, params: Record<string, string>, token = "test-auth-token") {
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join("");
  return crypto.createHmac("sha1", token).update(data).digest("base64");
}

async function main() {
  const server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  try {
    console.log("\nVoice notes, directory, WhatsApp post, calls and SMS tests\n");
    const thato = await login("0710000001");
    const kgomotso = await login("0710000002");
    const naledi = await login("0710000005");
    const support = await login("0710000004");
    const setup = await call(support, "POST", "/api/support/mfa/setup");
    assert.equal((await call(support, "POST", "/api/support/mfa/verify", { code: totpCode(setup.data.secret, currentStep()) })).status, 200);

    // ---- Voice notes ----
    const webm = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), crypto.randomBytes(200)]);
    await check("a seller records a voice note for their product; customers can play it", async () => {
      const r = await call(kgomotso, "PUT", "/api/seller/products/1/voice?seconds=12", webm, "audio/webm");
      assert.equal(r.status, 201);
      const p = (await call("", "GET", "/api/products/1")).data;
      assert.equal(p.voiceNote.seconds, 12);
      const audio = await call("", "GET", p.voiceNote.url);
      assert.equal(audio.status, 200);
      assert.equal(audio.headers.get("content-type"), "audio/webm");
    });

    await check("only real audio is accepted, and only on your own product", async () => {
      assert.equal((await call(kgomotso, "PUT", "/api/seller/products/1/voice", Buffer.from("not audio at all"), "audio/webm")).status, 422);
      assert.equal((await call(naledi, "PUT", "/api/seller/products/1/voice", webm, "audio/webm")).status, 404);
    });

    await check("a new recording replaces the old one; deleting removes it", async () => {
      await call(kgomotso, "PUT", "/api/seller/products/1/voice?seconds=30", webm, "audio/webm");
      assert.equal(Number((await pool.query("SELECT count(*) FROM voice_notes WHERE product_id = 1")).rows[0].count), 1);
      assert.equal((await call(kgomotso, "DELETE", "/api/seller/products/1/voice")).status, 204);
      assert.equal((await call("", "GET", "/api/products/1")).data.voiceNote, null);
    });

    // ---- Directory ----
    let listingId = 0;
    await check("anyone signed in can suggest a listing, but only with the owner's consent", async () => {
      const body = { name: "Test Tiling", category: "building", area: "Seoding", phone: "072 111 2222", description: "Floors and walls" };
      assert.equal((await call(thato, "POST", "/api/directory", body)).status, 422, "no consent");
      const r = await call(thato, "POST", "/api/directory", { ...body, consent: true });
      assert.equal(r.status, 201);
      listingId = r.data.id;
    });

    await check("a listing is public only after support approves it, with a reason in the audit log", async () => {
      const before = (await call("", "GET", "/api/directory?q=tiling")).data.listings;
      assert.equal(before.length, 0);
      assert.equal((await call(thato, "POST", `/api/support/directory/${listingId}`, { decision: "approve", reason: "Checked" })).status, 403);
      assert.equal((await call(support, "POST", `/api/support/directory/${listingId}`, { decision: "approve", reason: "Phoned the owner." })).status, 200);
      const after = (await call("", "GET", "/api/directory?q=tiling")).data.listings;
      assert.equal(after[0].phone, "+27721112222");
      const log = await pool.query("SELECT 1 FROM audit_events WHERE action = 'directory.approve' AND resource_id = $1", [String(listingId)]);
      assert.equal(log.rowCount, 1);
    });

    await check("the directory can be filtered by kind of service", async () => {
      const r = (await call("", "GET", "/api/directory?category=plumbing")).data.listings;
      assert.ok(r.length >= 1 && r.every((l: any) => l.category === "plumbing"));
    });

    // ---- WhatsApp channel post ----
    await check("support gets a weekly WhatsApp post where every item links back to the site", async () => {
      const r = await call(support, "GET", "/api/support/whatsapp-post");
      assert.equal(r.status, 200);
      assert.match(r.data.text, /This week on KurumanMarketPlace/);
      assert.match(r.data.text, /Entrepreneur of the Month/);
      assert.match(r.data.text, /kurumanmarketplace\.example\/shop\/\d+/);
      assert.equal((await call(thato, "GET", "/api/support/whatsapp-post")).status, 403);
    });

    // ---- Free calls ----
    const order = (await pool.query(
      `INSERT INTO orders (consumer_id, business_id, fulfilment, payment_method, subtotal_cents, total_cents, accept_by, idempotency_key, request_hash)
       SELECT u.id, 1, 'pickup', 'cash', 2500, 2500, now() + interval '30 minutes', 'call-test', repeat('0', 64)
         FROM users u WHERE u.phone = '+27710000001' RETURNING id`
    )).rows[0].id;
    let callId = 0;

    await check("the customer of an active order can call the seller: a token, never a phone number", async () => {
      const r = await call(thato, "POST", "/api/calls/start", { orderId: Number(order), with: "seller" });
      assert.equal(r.status, 200);
      callId = r.data.callId;
      assert.ok(!r.text.includes("+2771"), "no phone number in the answer");
      const [, payload] = r.data.token.split(".");
      const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
      assert.equal(claims.grants.voice.outgoing.application_sid, "APtest");
      assert.ok(claims.exp - claims.iat <= 600, "short-lived");
    });

    await check("strangers can't call: not your order, or a shop that didn't switch calls on", async () => {
      assert.equal((await call(naledi, "POST", "/api/calls/start", { orderId: Number(order), with: "customer" })).status, 403);
      assert.equal((await call(thato, "POST", "/api/calls/start", { shopId: 2 })).status, 403);
    });

    await check("Twilio's request must carry a valid signature; then the call is dialled once, for 5 minutes", async () => {
      const url = "https://kurumanmarketplace.example/api/calls/twiml";
      const params = { callId: String(callId), CallSid: "CA123" };
      const form = new URLSearchParams(params).toString();
      const forged = await fetch(base + "/api/calls/twiml", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Twilio-Signature": twilioSign(url, params, "wrong") },
        body: form,
      });
      assert.equal(forged.status, 403);
      const ok = await fetch(base + "/api/calls/twiml", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Twilio-Signature": twilioSign(url, params) },
        body: form,
      });
      const twiml = await ok.text();
      assert.match(twiml, /<Dial callerId="\+15005550006" timeLimit="300"><Number>\+27710000002<\/Number><\/Dial>/);
      const again = await fetch(base + "/api/calls/twiml", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Twilio-Signature": twilioSign(url, params) },
        body: form,
      });
      assert.match(await again.text(), /expired/, "a call id works only once");
    });

    await check("at most 10 free calls a day per person", async () => {
      await pool.query(
        "INSERT INTO calls (caller_id, callee_phone) SELECT id, '+27710000002' FROM users, generate_series(1, 9) WHERE phone = '+27710000001'"
      );
      assert.equal((await call(thato, "POST", "/api/calls/start", { orderId: Number(order), with: "seller" })).status, 429);
    });

    // ---- Real SMS through BulkSMS (fetch is replaced, so nothing leaves this computer) ----
    await check("SMS goes to BulkSMS with the token - but never to the demo accounts' made-up numbers", async () => {
      const sent: { url: string; body: any; auth: string }[] = [];
      const realFetch = globalThis.fetch;
      globalThis.fetch = (async (url: any, init: any) => {
        sent.push({ url: String(url), body: JSON.parse(init.body), auth: init.headers.Authorization });
        return new Response("[]", { status: 201 });
      }) as typeof fetch;
      process.env.BULKSMS_TOKEN_ID = "id1";
      process.env.BULKSMS_TOKEN_SECRET = "secret1";
      try {
        await sendSms("+27710000002", "demo number: logged only");
        await sendSms("+27821234567", "real number");
      } finally {
        globalThis.fetch = realFetch;
        delete process.env.BULKSMS_TOKEN_ID;
        delete process.env.BULKSMS_TOKEN_SECRET;
      }
      assert.equal(sent.length, 1);
      assert.equal(sent[0].url, "https://api.bulksms.com/v1/messages");
      assert.deepEqual(sent[0].body, { to: "+27821234567", body: "real number" });
      assert.equal(sent[0].auth, `Basic ${Buffer.from("id1:secret1").toString("base64")}`);
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
