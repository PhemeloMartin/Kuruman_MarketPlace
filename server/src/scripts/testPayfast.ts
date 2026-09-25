// Test TC-11 (spec 11.2): Payfast contract tests with controlled local fixtures (spec 5.5).
//
//   npm run test:payfast
//
// Starts its own copy of the API on a spare port and plays the part of Payfast, sending
// signed ITN notifications for each case the specification names: browser-return-only,
// forged signature, wrong amount, wrong merchant, genuine payment, repeated notification,
// a second genuine capture, and a capture that arrives after the order expired.
//
// Uses test-only Payfast settings. Payfast's source-IP and server "validate" checks can't
// pass for local fake notifications, so they are switched off HERE ONLY - the signature,
// merchant, reference and amount checks are all still active.
// It adds demo orders to the database: run `npm run db:setup` and `npm run db:seed` afterwards.

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
import { expireOverdueOrders } from "../lib/expiry";
import { itnSignature, payfastEncode } from "../lib/payfast";

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

// Plays Payfast: sends an ITN, signed with the given passphrase, in Payfast's field order.
async function sendItn(fields: Record<string, string>, passphrase = process.env.PAYFAST_PASSPHRASE!) {
  const ordered: [string, string][] = [
    ["m_payment_id", fields.m_payment_id],
    ["pf_payment_id", fields.pf_payment_id],
    ["payment_status", fields.payment_status ?? "COMPLETE"],
    ["item_name", fields.item_name ?? "KurumanMarketPlace order"],
    ["item_description", ""],
    ["amount_gross", fields.amount_gross],
    ["amount_fee", "-2.30"],
    ["amount_net", "72.70"],
    ["custom_str1", ""],
    ["name_first", ""],
    ["name_last", ""],
    ["email_address", ""],
    ["merchant_id", fields.merchant_id ?? "10000100"],
  ];
  ordered.push(["signature", fields.signature ?? itnSignature(ordered, passphrase)]);
  const body = ordered.map(([k, v]) => `${k}=${payfastEncode(v)}`).join("&");
  const res = await fetch(base + "/api/payments/payfast/notify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  return res.status;
}

async function orderState(orderId: number) {
  const o = await pool.query("SELECT status FROM orders WHERE id = $1", [orderId]);
  const p = await pool.query(
    "SELECT status, count(*)::int AS n FROM payments WHERE order_id = $1 GROUP BY status ORDER BY status",
    [orderId]
  );
  return { status: o.rows[0].status as string, payments: Object.fromEntries(p.rows.map((r) => [r.status, r.n])) };
}

async function lastEvent(): Promise<string> {
  const r = await pool.query("SELECT outcome FROM payment_events ORDER BY id DESC LIMIT 1");
  return r.rows[0]?.outcome;
}

async function check(name: string, fn: () => Promise<void>) {
  await fn();
  passed++;
  console.log(`  PASS  ${name}`);
}

async function placeAcceptedOnlineOrder(customer: string, seller: string, key: string, productId = 3) {
  const created = await call(customer, "POST", "/api/orders", {
    businessId: 1,
    items: [{ productId, quantity: 1 }],
    fulfilment: "delivery",
    deliveryAddress: "12 Test Street, near the clinic",
    paymentMethod: "online",
  }, { "Idempotency-Key": key });
  assert.equal(created.status, 201, "order created");
  const accepted = await call(seller, "POST", `/api/seller/orders/${created.data.id}/accept`);
  assert.equal(accepted.data.status, "awaiting_payment", "online acceptance -> awaiting payment");
  return created.data.id as number;
}

async function main() {
  const server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const run = Date.now().toString(36);

  try {
    const customer = await login("0710000001");
    const otherCustomer = await login("0710000003");
    const seller = await login("0710000002");

    console.log("\nTC-11 Payfast contract tests\n");
    const orderId = await placeAcceptedOnlineOrder(customer, seller, `pf-${run}-a`);
    let reference = "";
    let amount = "";

    await check("seller accepts first; the customer then gets a signed Payfast checkout form", async () => {
      const r = await call(customer, "POST", `/api/orders/${orderId}/payment-attempts`);
      assert.equal(r.status, 200);
      assert.match(r.data.action, /sandbox\.payfast\.co\.za\/eng\/process/);
      assert.ok(r.data.fields.signature?.length === 32, "form is signed");
      reference = r.data.fields.m_payment_id;
      amount = r.data.fields.amount;
    });

    await check("asking again re-uses the same unfinished attempt (no second charge)", async () => {
      const r = await call(customer, "POST", `/api/orders/${orderId}/payment-attempts`);
      assert.equal(r.data.fields.m_payment_id, reference);
    });

    await check("another customer can't start a payment for this order", async () => {
      const r = await call(otherCustomer, "POST", `/api/orders/${orderId}/payment-attempts`);
      assert.equal(r.status, 404);
    });

    await check("browser return alone does NOT mark the order paid", async () => {
      // The return_url only brings the customer back to /orders; nothing reaches the server.
      assert.equal((await orderState(orderId)).status, "awaiting_payment");
    });

    await check("forged notification (wrong signature) is rejected", async () => {
      const status = await sendItn({ m_payment_id: reference, pf_payment_id: `F${run}1`, amount_gross: amount }, "guessed passphrase");
      assert.equal(status, 400);
      assert.equal(await lastEvent(), "rejected_signature");
      assert.equal((await orderState(orderId)).status, "awaiting_payment");
    });

    await check("wrong amount is rejected even with a valid signature", async () => {
      const status = await sendItn({ m_payment_id: reference, pf_payment_id: `F${run}2`, amount_gross: "1.00" });
      assert.equal(status, 400);
      assert.equal(await lastEvent(), "rejected_amount");
    });

    await check("wrong merchant is rejected", async () => {
      const status = await sendItn({ m_payment_id: reference, pf_payment_id: `F${run}3`, amount_gross: amount, merchant_id: "10009999" });
      assert.equal(status, 400);
      assert.equal(await lastEvent(), "rejected_merchant");
    });

    await check("unknown payment reference is rejected", async () => {
      const status = await sendItn({ m_payment_id: "KMP-999999-P1", pf_payment_id: `F${run}4`, amount_gross: amount });
      assert.equal(status, 400);
      assert.equal(await lastEvent(), "rejected_unknown_reference");
    });

    await check("genuine verified payment confirms the order", async () => {
      const status = await sendItn({ m_payment_id: reference, pf_payment_id: `G${run}1`, amount_gross: amount });
      assert.equal(status, 200);
      assert.equal(await lastEvent(), "applied");
      const s = await orderState(orderId);
      assert.equal(s.status, "confirmed");
      assert.deepEqual(s.payments, { paid: 1 });
    });

    await check("the same notification again changes nothing (duplicate ignored)", async () => {
      const status = await sendItn({ m_payment_id: reference, pf_payment_id: `G${run}1`, amount_gross: amount });
      assert.equal(status, 200);
      assert.equal(await lastEvent(), "duplicate_ignored");
      assert.deepEqual((await orderState(orderId)).payments, { paid: 1 });
    });

    await check("a second genuine capture is kept for refund, never applied twice", async () => {
      const status = await sendItn({ m_payment_id: reference, pf_payment_id: `G${run}2`, amount_gross: amount });
      assert.equal(status, 200);
      assert.equal(await lastEvent(), "unapplied_needs_refund");
      const s = await orderState(orderId);
      assert.equal(s.status, "confirmed");
      assert.deepEqual(s.payments, { paid: 1, unapplied: 1 });
    });

    await check("payment arriving after the order expired: money recorded, order NOT revived, no oversell", async () => {
      const lateOrder = await placeAcceptedOnlineOrder(customer, seller, `pf-${run}-b`, 5);
      const r = await call(customer, "POST", `/api/orders/${lateOrder}/payment-attempts`);
      const before = await pool.query("SELECT stock_qty - reserved_qty AS a FROM products WHERE id = 5");
      await pool.query("UPDATE orders SET payment_due_at = now() - interval '1 minute' WHERE id = $1", [lateOrder]);
      await expireOverdueOrders();
      assert.equal((await orderState(lateOrder)).status, "expired");

      const status = await sendItn({ m_payment_id: r.data.fields.m_payment_id, pf_payment_id: `L${run}1`, amount_gross: r.data.fields.amount });
      assert.equal(status, 200);
      assert.equal(await lastEvent(), "unapplied_needs_refund");
      const s = await orderState(lateOrder);
      assert.equal(s.status, "expired");
      assert.deepEqual(s.payments, { unapplied: 1 });
      const after = await pool.query("SELECT stock_qty - reserved_qty AS a FROM products WHERE id = 5");
      assert.equal(after.rows[0].a, before.rows[0].a + 1, "the expired order's unit went back on sale and stays there");
    });

    await check("a cash order can't be sent to Payfast", async () => {
      const created = await call(customer, "POST", "/api/orders", {
        businessId: 1, items: [{ productId: 2, quantity: 1 }], fulfilment: "pickup", paymentMethod: "cash",
      }, { "Idempotency-Key": `pf-${run}-c` });
      await call(seller, "POST", `/api/seller/orders/${created.data.id}/accept`);
      const r = await call(customer, "POST", `/api/orders/${created.data.id}/payment-attempts`);
      assert.equal(r.status, 409);
    });

    console.log(`\nTC-11: ${passed} checks PASSED`);
    console.log("Reminder: this added test orders. Reset with `npm run db:setup` then `npm run db:seed`.");
  } finally {
    server.close();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(`\nTC-11: FAILED after ${passed} passing checks\n`, err);
  process.exitCode = 1;
});
