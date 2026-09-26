// Test TC-16 (spec 11.2) and the money side of TC-21: refunds capped at the captured amount,
// refunds needing provider evidence, and cash disputes resolved by support.
//
//   npm run test:refunds
//
// Starts its own copy of the API on a spare port. It plays Payfast (like test:payfast, with
// test-only settings and the source-IP / server-validate checks switched off HERE ONLY),
// and the customer, seller, courier and support staff in turn.
// It adds orders to the database: run `npm run db:setup` and `npm run db:seed` afterwards.

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

async function staffLogin(phone: string): Promise<string> {
  const cookie = await login(phone);
  const setup = await call(cookie, "POST", "/api/support/mfa/setup");
  const v = await call(cookie, "POST", "/api/support/mfa/verify", { code: totpCode(setup.data.secret, currentStep()) });
  assert.equal(v.status, 200, "staff MFA");
  return cookie;
}

// Plays Payfast: a signed "payment complete" notification for one of our attempts.
async function payfastPaid(reference: string, pfPaymentId: string, amount: string) {
  const fields: [string, string][] = [
    ["m_payment_id", reference],
    ["pf_payment_id", pfPaymentId],
    ["payment_status", "COMPLETE"],
    ["item_name", "KurumanMarketPlace order"],
    ["amount_gross", amount],
    ["merchant_id", "10000100"],
  ];
  fields.push(["signature", itnSignature(fields, process.env.PAYFAST_PASSPHRASE!)]);
  const res = await fetch(base + "/api/payments/payfast/notify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: fields.map(([k, v]) => `${k}=${payfastEncode(v)}`).join("&"),
  });
  assert.equal(res.status, 200, "ITN accepted");
}

async function check(name: string, fn: () => Promise<void>) {
  await fn();
  passed++;
  console.log(`  PASS  ${name}`);
}

async function main() {
  const server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const run = Date.now().toString(36);

  try {
    console.log("\nTC-16 refunds and cash disputes\n");
    const customer = await login("0710000001");
    const seller = await login("0710000002");
    const courier = await login("0710000003");
    const support = await staffLogin("0710000004");
    const approvalsOnly = await staffLogin("0710000007");

    // The spec's example: R75 captured (2 x spinach at R25 + R25 delivery).
    const created = await call(customer, "POST", "/api/orders", {
      businessId: 1, items: [{ productId: 1, quantity: 2 }], fulfilment: "delivery",
      deliveryAddress: "12 Test Street", paymentMethod: "online",
    }, { "Idempotency-Key": `rf-${run}-1` });
    assert.equal(created.data.totalCents, 7500);
    const orderId = created.data.id;
    await call(seller, "POST", `/api/seller/orders/${orderId}/accept`);
    const attempt = await call(customer, "POST", `/api/orders/${orderId}/payment-attempts`);
    const reference = attempt.data.fields.m_payment_id;

    let caseId = 0;
    await check("a second genuine payment opens a refund case for support automatically", async () => {
      await payfastPaid(reference, `${run}001`, "75.00");
      await payfastPaid(reference, `${run}002`, "75.00"); // customer paid twice
      const cases = await call(support, "GET", "/api/support/money/cases");
      const c = cases.data.find((x: any) => x.type === "refund" && x.order.id === orderId && x.status === "open");
      assert.ok(c, "refund case opened");
      assert.deepEqual(c.payments.map((p: any) => p.status).sort(), ["paid", "unapplied"]);
      caseId = c.id;
    });

    await check("staff without the payments scope can't see money cases", async () => {
      assert.equal((await call(approvalsOnly, "GET", "/api/support/money/cases")).status, 403);
    });

    const payments = (await call(support, "GET", "/api/support/money/cases")).data.find((x: any) => x.id === caseId).payments;
    const unapplied = payments.find((p: any) => p.status === "unapplied");
    const paid = payments.find((p: any) => p.status === "paid");

    let firstRefund = 0;
    await check("TC-16: against R75 captured, refund R50, then a conflicting R50 is refused", async () => {
      const a = await call(support, "POST", `/api/support/money/refund-cases/${caseId}/refunds`, {
        paymentId: unapplied.id, amountCents: 5000, reason: "Customer paid twice - refund part one.",
      });
      assert.equal(a.status, 201);
      firstRefund = a.data.id;
      const b = await call(support, "POST", `/api/support/money/refund-cases/${caseId}/refunds`, {
        paymentId: unapplied.id, amountCents: 5000, reason: "Second refund attempt by mistake.",
      });
      assert.equal(b.status, 409);
      assert.equal(b.data.refundableCents, 2500);
    });

    await check("two simultaneous R50 refunds on the same R75 payment: exactly one is accepted", async () => {
      const body = { paymentId: paid.id, amountCents: 5000, reason: "Race test - simultaneous refunds." };
      const results = await Promise.all([
        call(support, "POST", `/api/support/money/refund-cases/${caseId}/refunds`, body),
        call(support, "POST", `/api/support/money/refund-cases/${caseId}/refunds`, body),
      ]);
      assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
      // Tidy up: this refund was only for the race, so mark it failed (frees the amount).
      const winner = results.find((r) => r.status === 201)!;
      assert.equal((await call(support, "POST", `/api/support/money/refunds/${winner.data.id}/fail`, { reason: "Test refund only." })).status, 200);
    });

    await check("a refund can't be marked done without Payfast's refund reference", async () => {
      const r = await call(support, "POST", `/api/support/money/refunds/${firstRefund}/complete`, { providerReference: "" });
      assert.equal(r.status, 422);
      await assert.rejects(
        pool.query("UPDATE refunds SET status = 'succeeded', completed_at = now() WHERE id = $1", [firstRefund]),
        /check constraint/,
        "the database refuses too"
      );
    });

    await check("while Payfast hasn't confirmed, the customer sees 'being processed', not 'refunded'", async () => {
      const mine = (await call(customer, "GET", "/api/orders/mine")).data.find((o: any) => o.id === orderId);
      assert.equal(mine.refundPendingCents, 5000);
      assert.equal(mine.refundedCents, 0);
    });

    await check("with evidence the refund succeeds, and the customer sees it", async () => {
      assert.equal((await call(support, "POST", `/api/support/money/refunds/${firstRefund}/complete`, { providerReference: "PF-REFUND-1001" })).status, 200);
      const mine = (await call(customer, "GET", "/api/orders/mine")).data.find((o: any) => o.id === orderId);
      assert.equal(mine.refundedCents, 5000);
      assert.equal(mine.refundPendingCents, 0);
    });

    await check("the case can't be closed while unapplied money is still owed", async () => {
      const r = await call(support, "POST", `/api/support/money/refund-cases/${caseId}/close`, { reason: "Trying to close early." });
      assert.equal(r.status, 409);
    });

    await check("once the second payment is fully refunded it's marked refunded and the case closes", async () => {
      const rest = await call(support, "POST", `/api/support/money/refund-cases/${caseId}/refunds`, {
        paymentId: unapplied.id, amountCents: 2500, reason: "Customer paid twice - the rest.",
      });
      await call(support, "POST", `/api/support/money/refunds/${rest.data.id}/complete`, { providerReference: "PF-REFUND-1002" });
      const p = await pool.query("SELECT status FROM payments WHERE id = $1", [unapplied.id]);
      assert.equal(p.rows[0].status, "refunded");
      const q = await pool.query("SELECT status FROM payments WHERE id = $1", [paid.id]);
      assert.equal(q.rows[0].status, "paid", "the order's own payment is untouched");
      const close = await call(support, "POST", `/api/support/money/refund-cases/${caseId}/close`, { reason: "Second payment returned in full." });
      assert.equal(close.status, 200);
    });

    // ---- Cash dispute: a real delivery through the courier routes ----
    const cashOrder = await call(customer, "POST", "/api/orders", {
      businessId: 1, items: [{ productId: 3, quantity: 1 }], fulfilment: "delivery",
      deliveryAddress: "12 Test Street", paymentMethod: "cash",
    }, { "Idempotency-Key": `rf-${run}-2` });
    const cashId = cashOrder.data.id;
    await call(seller, "POST", `/api/seller/orders/${cashId}/accept`);
    await call(seller, "POST", `/api/seller/orders/${cashId}/ready`);
    const job = (await call(courier, "GET", "/api/courier/jobs")).data.find((j: any) => j.cashToCollectCents === cashOrder.data.totalCents);
    await call(courier, "POST", `/api/courier/jobs/${job.id}/claim`);
    await call(seller, "POST", `/api/seller/orders/${cashId}/release`);
    await call(courier, "POST", `/api/courier/jobs/${job.id}/collect`);
    const code = (await call(customer, "POST", `/api/orders/${cashId}/handover-code`)).data.code;
    assert.equal((await call(courier, "POST", `/api/courier/jobs/${job.id}/deliver`, { code })).status, 200);

    let cashCase = 0;
    await check("a seller receiving less cash than collected opens a cash case for support", async () => {
      const ack = await call(seller, "POST", `/api/seller/cash/${cashId}/acknowledge`, { receivedCents: cashOrder.data.totalCents - 1000 });
      assert.equal(ack.data.status, "disputed");
      const c = (await call(support, "GET", "/api/support/money/cases")).data.find((x: any) => x.type === "cash_dispute" && x.order.id === cashId);
      assert.ok(c);
      assert.equal(c.cash.collectedCents - c.cash.remittedCents, 1000);
      cashCase = c.id;
    });

    await check("the shortfall stays in the seller's 'cash still to reach you' until it's resolved", async () => {
      const d = await call(seller, "GET", "/api/seller/dashboard");
      assert.equal(d.data.kpis.unreconciledCashCents, 1000);
    });

    await check("notes are kept with the case (in the audit log)", async () => {
      assert.equal((await call(support, "POST", `/api/support/money/cases/${cashCase}/notes`, { reason: "Phoned Pieter: he still has R10." })).status, 201);
      const c = (await call(support, "GET", "/api/support/money/cases")).data.find((x: any) => x.id === cashCase);
      assert.match(c.notes[0].text, /still has R10/);
    });

    await check("support records the rest handed over: cash reconciled, case closed", async () => {
      assert.equal((await call(support, "POST", `/api/support/money/cash-cases/${cashCase}/settle`, { reason: "" })).status, 422);
      const r = await call(support, "POST", `/api/support/money/cash-cases/${cashCase}/settle`, { reason: "Seller confirmed receiving the missing R10." });
      assert.equal(r.status, 200);
      const d = await call(seller, "GET", "/api/seller/dashboard");
      assert.equal(d.data.kpis.unreconciledCashCents, 0);
      assert.equal((await call(support, "POST", `/api/support/money/cash-cases/${cashCase}/settle`, { reason: "Again by mistake." })).status, 409);
    });

    await check("every money decision is in the audit log", async () => {
      const r = await call(support, "GET", "/api/support/audit");
      const actions = r.data.map((a: any) => a.action);
      for (const a of ["case.open", "refund.request", "refund.complete", "refund.fail", "case.close", "case.note", "cash.settle"]) {
        assert.ok(actions.includes(a), `missing ${a}`);
      }
    });

    console.log(`\nTC-16: ${passed} checks PASSED`);
    console.log("Reminder: this added test orders. Reset with `npm run db:setup` then `npm run db:seed`.");
  } finally {
    server.close();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(`\nTC-16: FAILED after ${passed} passing checks\n`, err);
  process.exitCode = 1;
});
