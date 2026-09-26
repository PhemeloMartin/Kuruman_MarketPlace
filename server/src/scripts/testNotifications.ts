// Test TC-17 (spec 11.2): transactional notifications survive a notifier failure and are never
// duplicated. "Stop the notification worker, submit an order, restart/retry the worker and
// inspect the order, outbox and user message records."
//
//   npm run test:notifications
//
// This script's own copy of the API does NOT start the worker - the worker is "stopped" until the
// test runs it by hand with processOutbox(). Stop any other running API first (npm run dev), or
// its worker would deliver the events in the background.
// It adds orders: run `npm run db:setup` and `npm run db:seed` afterwards.

process.env.PAYFAST_MERCHANT_ID = "10000100";
process.env.PAYFAST_MERCHANT_KEY = "46f0cd694581a";
process.env.PAYFAST_PASSPHRASE = "local contract test passphrase";
process.env.PAYFAST_SANDBOX = "true";
process.env.PAYFAST_VERIFY_SOURCE_IP = "false";
process.env.PAYFAST_VERIFY_WITH_SERVER = "false";

import assert from "assert/strict";
import { AddressInfo } from "net";
import { app } from "../app";
import { pool } from "../db";
import { processOutbox } from "../lib/notificationWorker";
import { itnSignature, payfastEncode } from "../lib/payfast";
import { currentStep, totpCode } from "../lib/totp";

const ORIGIN = "http://localhost:5173";
let base = "";
let passed = 0;

async function call(cookie: string, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { Origin: ORIGIN, Cookie: cookie, ...(body ? { "Content-Type": "application/json" } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null, setCookie: res.headers.get("set-cookie") };
}

async function login(phone: string): Promise<string> {
  const r = await call("", "POST", "/api/auth/login", { phone, passphrase: "Kuruman Oasis 2026" });
  assert.equal(r.status, 200, `login ${phone}`);
  return r.setCookie!.split(";")[0];
}

async function check(name: string, fn: () => Promise<void>) {
  await fn();
  passed++;
  console.log(`  PASS  ${name}`);
}

const count = async (sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows[0].n as number;
const notesFor = (phone: string, template: string) =>
  count(
    "SELECT count(*)::int AS n FROM notifications n JOIN users u ON u.id = n.user_id WHERE u.phone = $1 AND n.template_key = $2",
    [phone, template]
  );

async function main() {
  const server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const run = Date.now().toString(36);

  try {
    console.log("\nTC-17 notifications\n");
    const customer = await login("0710000001");
    const seller = await login("0710000002");

    // The worker is stopped: an order is placed.
    const body = { businessId: 1, items: [{ productId: 1, quantity: 1 }], fulfilment: "pickup", paymentMethod: "cash" };
    const placed = await call(customer, "POST", "/api/orders", body, { "Idempotency-Key": `nt-${run}-1` });
    const orderId = placed.data.id;
    const eventId = async () =>
      (await pool.query("SELECT id FROM outbox_events WHERE aggregate_id = $1 AND payload->>'to' = 'pending_acceptance'", [orderId])).rows[0].id;

    await check("with the worker stopped, the order is still committed and its notification waits in the outbox", async () => {
      assert.equal(placed.status, 201);
      const e = await pool.query("SELECT status FROM outbox_events WHERE id = $1", [await eventId()]);
      assert.equal(e.rows[0].status, "pending");
      assert.equal(await notesFor("+27710000002", "seller.new_order"), 0);
    });

    await check("a failing notifier doesn't touch the order; the event is kept for a later retry", async () => {
      const r = await processOutbox({ failWith: "SMS provider unavailable (simulated)" });
      assert.ok(r.failed >= 1);
      const e = await pool.query("SELECT status, attempts, last_error, available_at > now() AS later FROM outbox_events WHERE id = $1", [await eventId()]);
      assert.deepEqual([e.rows[0].status, e.rows[0].attempts, e.rows[0].later], ["pending", 1, true]);
      assert.match(e.rows[0].last_error, /unavailable/);
      assert.equal((await pool.query("SELECT status FROM orders WHERE id = $1", [orderId])).rows[0].status, "pending_acceptance");
    });

    await check("when the worker runs again, the seller gets exactly one 'new order' notification", async () => {
      await pool.query("UPDATE outbox_events SET available_at = now() WHERE status = 'pending'");
      await processOutbox();
      assert.equal(await notesFor("+27710000002", "seller.new_order"), 1);
    });

    await check("re-delivering the same event can't create a second notification", async () => {
      await pool.query("UPDATE outbox_events SET status = 'pending', available_at = now() WHERE id = $1", [await eventId()]);
      await processOutbox();
      assert.equal(await notesFor("+27710000002", "seller.new_order"), 1);
    });

    await check("replaying the order request (same key) creates no new order and no new event", async () => {
      const before = await count("SELECT count(*)::int AS n FROM outbox_events");
      const again = await call(customer, "POST", "/api/orders", body, { "Idempotency-Key": `nt-${run}-1` });
      assert.equal(again.data.id, orderId);
      assert.equal(await count("SELECT count(*)::int AS n FROM outbox_events"), before);
    });

    await check("a request that fails and rolls back leaves no event behind", async () => {
      const before = await count("SELECT count(*)::int AS n FROM outbox_events");
      const tooMany = await call(customer, "POST", "/api/orders", { ...body, items: [{ productId: 1, quantity: 99 }] }, { "Idempotency-Key": `nt-${run}-2` });
      assert.ok(tooMany.status >= 400);
      assert.equal(await count("SELECT count(*)::int AS n FROM outbox_events"), before);
    });

    await check("a duplicate Payfast notification gives the customer one 'payment received', not two", async () => {
      const online = await call(customer, "POST", "/api/orders", { ...body, paymentMethod: "online" }, { "Idempotency-Key": `nt-${run}-3` });
      await call(seller, "POST", `/api/seller/orders/${online.data.id}/accept`);
      const attempt = await call(customer, "POST", `/api/orders/${online.data.id}/payment-attempts`);
      const fields: [string, string][] = [
        ["m_payment_id", attempt.data.fields.m_payment_id],
        ["pf_payment_id", `${run}77`],
        ["payment_status", "COMPLETE"],
        ["amount_gross", attempt.data.fields.amount],
        ["merchant_id", "10000100"],
      ];
      fields.push(["signature", itnSignature(fields, process.env.PAYFAST_PASSPHRASE!)]);
      const itn = fields.map(([k, v]) => `${k}=${payfastEncode(v)}`).join("&");
      for (let i = 0; i < 2; i++) {
        await fetch(base + "/api/payments/payfast/notify", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: itn });
      }
      await processOutbox();
      const n = await count(
        "SELECT count(*)::int AS n FROM notifications WHERE order_id = $1 AND template_key = 'customer.payment_received'",
        [online.data.id]
      );
      assert.equal(n, 1);
    });

    await check("people only see their own notifications, and can mark them read", async () => {
      const mine = (await call(customer, "GET", "/api/notifications")).data;
      assert.ok(mine.length > 0);
      assert.ok(!mine.some((x: any) => x.template.startsWith("seller.")), "no seller messages for the customer");
      assert.ok((await call(customer, "GET", "/api/notifications/unread-count")).data.unread > 0);
      await call(customer, "POST", "/api/notifications/read-all");
      assert.equal((await call(customer, "GET", "/api/notifications/unread-count")).data.unread, 0);
      assert.equal((await call("", "GET", "/api/notifications")).status, 401);
    });

    await check("after 5 failures the event is 'failed' and support can see and retry it", async () => {
      const support = await login("0710000004");
      const setup = await call(support, "POST", "/api/support/mfa/setup");
      await call(support, "POST", "/api/support/mfa/verify", { code: totpCode(setup.data.secret, currentStep()) });

      await call(seller, "POST", `/api/seller/orders/${orderId}/decline`, { reason: "Out of stock" });
      for (let i = 0; i < 5; i++) {
        await pool.query("UPDATE outbox_events SET available_at = now() WHERE status = 'pending'");
        await processOutbox({ failWith: "provider down" });
      }
      const failed = (await call(support, "GET", "/api/support/ops/outbox")).data;
      assert.ok(failed.some((e: any) => e.aggregateId === orderId && e.attempts === 5));
      assert.equal(await notesFor("+27710000001", "customer.declined"), 0);

      assert.equal((await call(support, "POST", "/api/support/ops/outbox/retry", { reason: "SMS provider back up." })).status, 200);
      await processOutbox();
      assert.equal(await notesFor("+27710000001", "customer.declined"), 1);
      assert.equal((await call(support, "GET", "/api/support/ops/outbox")).data.length, 0);
    });

    console.log(`\nTC-17: ${passed} checks PASSED`);
    console.log("Reminder: this added test orders. Reset with `npm run db:setup` then `npm run db:seed`.");
  } finally {
    server.close();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(`\nTC-17: FAILED after ${passed} passing checks\n`, err);
  process.exitCode = 1;
});
