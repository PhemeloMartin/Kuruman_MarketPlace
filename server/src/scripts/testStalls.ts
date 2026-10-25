// Market stalls and orders by SMS: a stall holder with a basic phone accepts, declines and completes
// orders by text message.
//
//   npm run test:stalls
//
// Runs in demo SMS mode (no real SMS). Stop any running API first (its notification worker would
// send the SMS before this test does). It adds orders: run `npm run db:setup` and `npm run db:seed` afterwards.

process.env.SMS_DEMO_SHOW_CODES = "true";
process.env.SMS_INBOUND_TOKEN = "test-inbound-token-123456";

import assert from "assert/strict";
import { AddressInfo } from "net";
import { app } from "../app";
import { pool } from "../db";
import { processOutbox } from "../lib/notificationWorker";

const ORIGIN = "http://localhost:5173";
const STALL_PHONE = "0710000014";
let base = "";
let passed = 0;

async function call(cookie: string, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { Origin: ORIGIN, Cookie: cookie, ...(body ? { "Content-Type": "application/json" } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null, text };
}

async function login(phone: string): Promise<string> {
  const r = await fetch(base + "/api/auth/login", {
    method: "POST",
    headers: { Origin: ORIGIN, "Content-Type": "application/json" },
    body: JSON.stringify({ phone, passphrase: process.env.SEED_PASSPHRASE || "Kuruman Oasis 2026" }),
  });
  assert.equal(r.status, 200, `login ${phone}`);
  return r.headers.get("set-cookie")!.split(";")[0];
}

const sms = (text: string, from = STALL_PHONE) => call("", "POST", "/api/demo/phone", { number: from, text });
const statusOf = async (id: number) => (await pool.query("SELECT status FROM orders WHERE id = $1", [id])).rows[0].status;

async function check(name: string, fn: () => Promise<void>) {
  await fn();
  passed++;
  console.log(`  PASS  ${name}`);
}

async function main() {
  const server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  try {
    console.log("\nMarket stall and SMS order tests\n");
    const thato = await login("0710000001");
    const stall = (await pool.query("SELECT id FROM businesses WHERE kind = 'market_stall'")).rows[0];
    const morogo = (await pool.query("SELECT id, stock_qty, reserved_qty FROM products WHERE name LIKE 'Morogo%'")).rows[0];
    const order = (fulfilment: string, qty = 2) =>
      call(thato, "POST", "/api/orders", {
        businessId: Number(stall.id), items: [{ productId: Number(morogo.id), quantity: qty }],
        fulfilment, deliveryAddress: fulfilment === "pickup" ? undefined : "12 Main Street, Kuruman", paymentMethod: "cash",
      }, { "Idempotency-Key": `stall-${fulfilment}-${qty}-${Date.now()}` });

    await check("a market stall is reserve-and-collect: delivery is refused", async () => {
      assert.equal((await order("delivery")).status, 422);
    });

    let first = 0;
    await check("a new order reaches the stall's basic phone by SMS, with how to answer", async () => {
      const r = await order("pickup", 2);
      assert.equal(r.status, 201);
      first = r.data.id;
      await processOutbox();
      const inbox = (await call("", "GET", `/api/demo/phone?number=${STALL_PHONE}`)).data;
      const last = inbox[inbox.length - 1];
      assert.match(last.body, /Thato wants 2 x Morogo/);
      assert.match(last.body, /Reply 1 to accept or 2 if sold out/);
    });

    await check("an SMS from a number that isn't the stall's changes nothing", async () => {
      const r = await sms("1", "0829999999");
      assert.match(r.data.reply, /isn't set up for SMS orders/);
      assert.equal(await statusOf(first), "pending_acceptance");
    });

    await check("replying 1 accepts it; at a stall a cash pickup is ready to collect at once", async () => {
      const r = await sms("1");
      assert.match(r.data.reply, /accepted/);
      assert.equal(await statusOf(first), "ready");
      const history = await pool.query("SELECT reason FROM order_status_history WHERE order_id = $1 ORDER BY id", [first]);
      assert.ok(history.rows.some((h) => h.reason === "Accepted by SMS"), "recorded in the order history");
    });

    await check("a wrong code is refused and the order stays waiting", async () => {
      const code = (await call(thato, "POST", `/api/orders/${first}/handover-code`)).data.code;
      const wrong = code === "000000" ? "111111" : "000000";
      const r = await sms(wrong);
      assert.match(r.data.reply, /doesn't match/);
      assert.equal(await statusOf(first), "ready");
    });

    await check("texting the customer's code completes the sale: stock used, cash recorded", async () => {
      const code = (await call(thato, "POST", `/api/orders/${first}/handover-code`)).data.code;
      const r = await sms(code);
      assert.match(r.data.reply, /code correct\. Hand over 2 x Morogo/);
      assert.match(r.data.reply, /Collect R30\.00 cash/);
      assert.equal(await statusOf(first), "completed");
      const p = (await pool.query("SELECT stock_qty, reserved_qty FROM products WHERE id = $1", [morogo.id])).rows[0];
      assert.equal(p.stock_qty, morogo.stock_qty - 2);
      assert.equal(p.reserved_qty, morogo.reserved_qty);
      const cash = (await pool.query("SELECT status FROM cash_receipts WHERE order_id = $1", [first])).rows[0];
      assert.equal(cash.status, "remitted");
    });

    await check("replying 2 declines as sold out and releases the reserved stock", async () => {
      const r = await order("pickup", 3);
      const before = (await pool.query("SELECT reserved_qty FROM products WHERE id = $1", [morogo.id])).rows[0].reserved_qty;
      const reply = await sms("2");
      assert.match(reply.data.reply, /sold out/);
      assert.equal(await statusOf(r.data.id), "declined");
      const after = (await pool.query("SELECT reserved_qty FROM products WHERE id = $1", [morogo.id])).rows[0].reserved_qty;
      assert.equal(after, before - 3);
    });

    await check("the gateway's address needs the secret token", async () => {
      assert.equal((await call("", "POST", "/api/sms/inbound", { from: STALL_PHONE, text: "1" })).status, 403);
      assert.equal((await call("", "POST", "/api/sms/inbound?token=wrong-token-wrong-token", { from: STALL_PHONE, text: "1" })).status, 403);
      assert.equal((await call("", "POST", `/api/sms/inbound?token=${process.env.SMS_INBOUND_TOKEN}`, { from: STALL_PHONE, text: "hello" })).status, 200);
    });

    await check("the stall page shows where and when - but not the stall holder's phone number", async () => {
      const r = await call("", "GET", `/api/shops/${stall.id}`);
      assert.equal(r.data.kind, "market_stall");
      assert.equal(r.data.stall.location, "Main Street, next to the taxi rank");
      assert.deepEqual(r.data.stall.days, [1, 2, 3, 4, 5, 6]);
      assert.equal(typeof r.data.stall.hereNow, "boolean");
      assert.ok(!r.text.includes("+27710000014") && !r.text.includes("0710000014"));
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
