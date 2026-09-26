// Tests for delivery exceptions (spec TC-15 "absent recipient", TC-16 "cancel paid orders and
// record a return case", BR-10 "no courier available") and the support "operations" queue.
//
//   npm run test:operations
//
// Starts its own copy of the API on a spare port and plays every person, plus Payfast (with
// test-only settings, as in test:payfast). It adds orders: run `npm run db:setup` and
// `npm run db:seed` afterwards.

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
import { flagUnclaimedDeliveries } from "../lib/expiry";
import { itnSignature, payfastEncode } from "../lib/payfast";
import { currentStep, totpCode } from "../lib/totp";

const ORIGIN = "http://localhost:5173";
let base = "";
let passed = 0;
let run = "";
let keyCounter = 0;

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

async function staffLogin(phone: string): Promise<string> {
  const cookie = await login(phone);
  const setup = await call(cookie, "POST", "/api/support/mfa/setup");
  const v = await call(cookie, "POST", "/api/support/mfa/verify", { code: totpCode(setup.data.secret, currentStep()) });
  assert.equal(v.status, 200, "staff MFA");
  return cookie;
}

async function check(name: string, fn: () => Promise<void>) {
  await fn();
  passed++;
  console.log(`  PASS  ${name}`);
}

let customer = "";
let seller = "";
let courier = "";

async function placeOrder(fulfilment: "pickup" | "delivery", paymentMethod: "cash" | "online", productId = 2) {
  const r = await call(customer, "POST", "/api/orders", {
    businessId: 1, items: [{ productId, quantity: 1 }], fulfilment,
    deliveryAddress: fulfilment === "delivery" ? "12 Test Street" : undefined, paymentMethod,
  }, { "Idempotency-Key": `ops-${run}-${++keyCounter}` });
  assert.equal(r.status, 201, "order placed");
  await call(seller, "POST", `/api/seller/orders/${r.data.id}/accept`);
  if (paymentMethod === "online") {
    const attempt = await call(customer, "POST", `/api/orders/${r.data.id}/payment-attempts`);
    const fields: [string, string][] = [
      ["m_payment_id", attempt.data.fields.m_payment_id],
      ["pf_payment_id", `${run}${keyCounter}`],
      ["payment_status", "COMPLETE"],
      ["amount_gross", attempt.data.fields.amount],
      ["merchant_id", "10000100"],
    ];
    fields.push(["signature", itnSignature(fields, process.env.PAYFAST_PASSPHRASE!)]);
    const itn = await fetch(base + "/api/payments/payfast/notify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: fields.map(([k, v]) => `${k}=${payfastEncode(v)}`).join("&"),
    });
    assert.equal(itn.status, 200);
  }
  await call(seller, "POST", `/api/seller/orders/${r.data.id}/ready`);
  return r.data.id as number;
}

// Claim, hand over and collect a delivery; returns the courier's job id.
async function courierCollects(orderId: number) {
  const orderNumber = (await pool.query("SELECT order_number FROM orders WHERE id = $1", [orderId])).rows[0].order_number;
  const d = await pool.query("SELECT id FROM deliveries WHERE order_id = $1", [orderId]);
  const jobId = Number(d.rows[0].id);
  assert.equal((await call(courier, "POST", `/api/courier/jobs/${jobId}/claim`)).status, 200, `claim ${orderNumber}`);
  await call(seller, "POST", `/api/seller/orders/${orderId}/release`);
  assert.equal((await call(courier, "POST", `/api/courier/jobs/${jobId}/collect`)).status, 200);
  return jobId;
}

const orderStatus = async (id: number) => (await pool.query("SELECT status FROM orders WHERE id = $1", [id])).rows[0].status;
const stockOf = async (productId: number) =>
  (await pool.query("SELECT stock_qty, reserved_qty FROM products WHERE id = $1", [productId])).rows[0];

async function main() {
  const server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  run = Date.now().toString(36);

  try {
    console.log("\nDelivery exceptions and the operations queue\n");
    customer = await login("0710000001");
    seller = await login("0710000002");
    courier = await login("0710000003");
    const support = await staffLogin("0710000004");
    const approvalsOnly = await staffLogin("0710000007");
    const opsCase = async (orderId: number) =>
      (await call(support, "GET", "/api/support/ops/cases")).data.find((c: any) => c.order.id === orderId && c.status === "open");

    // ---- A paid delivery where nobody is home ----
    const paidOrder = await placeOrder("delivery", "online");
    const job = await courierCollects(paidOrder);
    const stockAfterCollect = await stockOf(2);

    await check("TC-15: the courier can't just mark a failed handover as done; a reason is required", async () => {
      assert.equal((await call(courier, "POST", `/api/courier/jobs/${job}/fail`, { reason: "felt like it" })).status, 422);
      assert.equal((await call(courier, "POST", `/api/courier/jobs/${job}/fail`, { reason: "customer_absent" })).status, 200);
      assert.equal(await orderStatus(paidOrder), "delivery_failed");
    });

    await check("the failure opens a support case, and the customer's handover code stops working", async () => {
      const c = await opsCase(paidOrder);
      assert.equal(c.details.why, "delivery_failed");
      assert.equal((await call(customer, "POST", `/api/orders/${paidOrder}/handover-code`)).status, 409);
    });

    await check("staff without the operations scope can't open delivery cases", async () => {
      assert.equal((await call(approvalsOnly, "GET", "/api/support/ops/cases")).status, 403);
    });

    await check("seeing phone numbers for a case is written to the audit log", async () => {
      const c = await opsCase(paidOrder);
      const r = await call(support, "POST", `/api/support/ops/cases/${c.id}/contacts`);
      assert.equal(r.data.customer.phone, "+27710000001");
      const log = await call(support, "GET", "/api/support/audit?action=case.view_contacts");
      assert.equal(log.data[0].resourceId, String(c.id));
    });

    await check("a failed delivery can't be closed without deciding what happens", async () => {
      const c = await opsCase(paidOrder);
      assert.equal((await call(support, "POST", `/api/support/ops/cases/${c.id}/close`, { reason: "Nothing to do here." })).status, 409);
    });

    await check("support can have the courier try again; the customer gets a new code", async () => {
      const c = await opsCase(paidOrder);
      assert.equal((await call(support, "POST", `/api/support/ops/cases/${c.id}/retry`, { reason: "Customer home after 17:00." })).status, 200);
      assert.equal(await orderStatus(paidOrder), "out_for_delivery");
      assert.equal((await call(customer, "POST", `/api/orders/${paidOrder}/handover-code`)).status, 200);
    });

    await check("TC-16: cancelling a paid order after a second failure opens a refund case automatically", async () => {
      assert.equal((await call(courier, "POST", `/api/courier/jobs/${job}/fail`, { reason: "customer_refused" })).status, 200);
      const c = await opsCase(paidOrder);
      const r = await call(support, "POST", `/api/support/ops/cases/${c.id}/cancel-order`, { reason: "Customer refused the order." });
      assert.equal(r.status, 200);
      assert.equal(r.data.refundCaseOpened, true);
      assert.equal(await orderStatus(paidOrder), "cancelled");
      const money = (await call(support, "GET", "/api/support/money/cases")).data;
      assert.ok(money.find((m: any) => m.type === "refund" && m.order.id === paidOrder && m.details.why === "order_cancelled"));
    });

    await check("the cancelled order is not shown to the customer as refunded until Payfast confirms", async () => {
      const mine = (await call(customer, "GET", "/api/orders/mine")).data.find((o: any) => o.id === paidOrder);
      assert.equal(mine.status, "cancelled");
      assert.equal(mine.refundedCents, 0);
    });

    await check("the courier is told to bring the goods back (seller's address, not the customer's)", async () => {
      const mine = (await call(courier, "GET", "/api/courier/my-jobs")).data.find((j: any) => j.id === job);
      assert.equal(mine.status, "failed");
      assert.ok(mine.business.pickupAddress);
      assert.equal(mine.customer, null);
    });

    await check("returned goods go back on sale only when the seller says they're fine, and only once", async () => {
      assert.deepEqual(await stockOf(2), stockAfterCollect, "no automatic restock");
      const r = await call(seller, "POST", `/api/seller/orders/${paidOrder}/returned`, { restock: true });
      assert.equal(r.status, 200);
      const after = await stockOf(2);
      assert.equal(after.stock_qty, stockAfterCollect.stock_qty + 1);
      assert.equal((await call(seller, "POST", `/api/seller/orders/${paidOrder}/returned`, { restock: true })).status, 409);
    });

    // ---- BR-10: nobody takes the job ----
    const unclaimed = await placeOrder("delivery", "cash", 4);
    const reservedBefore = (await stockOf(4)).reserved_qty;

    await check("BR-10: a delivery nobody claims for 30 minutes goes to support - once", async () => {
      assert.equal(await flagUnclaimedDeliveries(), 0, "not yet 30 minutes");
      await pool.query("UPDATE deliveries SET created_at = now() - interval '31 minutes' WHERE order_id = $1", [unclaimed]);
      assert.equal(await flagUnclaimedDeliveries(), 1);
      assert.equal(await flagUnclaimedDeliveries(), 0, "not flagged twice");
      assert.equal((await opsCase(unclaimed)).details.why, "no_courier");
    });

    await check("cancelling an uncollected order releases its held stock and removes the job", async () => {
      const c = await opsCase(unclaimed);
      const r = await call(support, "POST", `/api/support/ops/cases/${c.id}/cancel-order`, { reason: "No courier; customer agreed to cancel." });
      assert.equal(r.data.refundCaseOpened, false, "cash order: nothing was paid");
      assert.equal((await stockOf(4)).reserved_qty, reservedBefore - 1);
      const jobId = Number((await pool.query("SELECT id FROM deliveries WHERE order_id = $1", [unclaimed])).rows[0].id);
      const jobs = (await call(courier, "GET", "/api/courier/jobs")).data;
      assert.ok(!jobs.some((j: any) => j.id === jobId));
    });

    // ---- A problem reported after receiving the order ----
    const pickup = await placeOrder("pickup", "online", 5);
    const code = (await call(customer, "POST", `/api/orders/${pickup}/handover-code`)).data.code;
    assert.equal((await call(seller, "POST", `/api/seller/orders/${pickup}/pickup`, { code })).status, 200);

    await check("the customer can report a problem with a received order; it goes to support", async () => {
      assert.equal((await call(customer, "POST", `/api/orders/${pickup}/problem`, { description: "bad" })).status, 422);
      assert.equal((await call(customer, "POST", `/api/orders/${pickup}/problem`, { description: "The vetkoek was stale and hard." })).status, 201);
      const mine = (await call(customer, "GET", "/api/orders/mine")).data.find((o: any) => o.id === pickup);
      assert.equal(mine.problemReported, true);
      assert.equal((await opsCase(pickup)).type, "order_problem");
    });

    await check("upholding it hands the refund to the payments queue", async () => {
      const c = await opsCase(pickup);
      assert.equal((await call(support, "POST", `/api/support/ops/cases/${c.id}/refund`, { reason: "Seller agrees the goods were stale." })).status, 200);
      const money = (await call(support, "GET", "/api/support/money/cases")).data;
      assert.ok(money.find((m: any) => m.type === "refund" && m.order.id === pickup && m.details.why === "customer_problem"));
    });

    await check("every operations decision is in the audit log", async () => {
      const actions = (await call(support, "GET", "/api/support/audit")).data.map((a: any) => a.action);
      for (const a of ["order.retry_delivery", "order.cancel", "order.goods_returned", "case.refund_requested", "case.view_contacts"]) {
        assert.ok(actions.includes(a), `missing ${a}`);
      }
    });

    console.log(`\nOperations: ${passed} checks PASSED`);
    console.log("Reminder: this added test orders. Reset with `npm run db:setup` then `npm run db:seed`.");
  } finally {
    server.close();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(`\nOperations tests: FAILED after ${passed} passing checks\n`, err);
  process.exitCode = 1;
});
