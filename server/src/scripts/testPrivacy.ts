// Test TC-20 (spec 11.2): privacy requests - access, correction and deletion - with verification,
// lawful holds, pseudonymised closure and the retention clean-up.
//
//   npm run test:privacy
//
// Starts its own copy of the API on a spare port. It creates a test account and orders:
// run `npm run db:setup` and `npm run db:seed` afterwards.

import assert from "assert/strict";
import { AddressInfo } from "net";
import { app } from "../app";
import { pool } from "../db";
import { runRetention } from "../lib/retention";
import { currentStep, totpCode } from "../lib/totp";

const ORIGIN = "http://localhost:5173";
const PASSPHRASE = "Kuruman Oasis 2026";
let base = "";
let passed = 0;

async function call(cookie: string, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { Origin: ORIGIN, Cookie: cookie, ...(body ? { "Content-Type": "application/json" } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null, text, setCookie: res.headers.get("set-cookie") };
}

async function login(phone: string, passphrase = PASSPHRASE): Promise<string> {
  const r = await call("", "POST", "/api/auth/login", { phone, passphrase });
  assert.equal(r.status, 200, `login ${phone}`);
  return r.setCookie!.split(";")[0];
}

async function staffLogin(phone: string): Promise<string> {
  const cookie = await login(phone);
  const setup = await call(cookie, "POST", "/api/support/mfa/setup");
  assert.equal((await call(cookie, "POST", "/api/support/mfa/verify", { code: totpCode(setup.data.secret, currentStep()) })).status, 200);
  return cookie;
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
  // A fresh, synthetic account that this test will close. Random digits, so reruns don't clash.
  const phone = "072" + String(Date.now()).slice(-7);

  try {
    console.log("\nTC-20 privacy requests\n");
    const thato = await login("0710000001");
    const pieter = await login("0710000003");
    const seller = await login("0710000002");
    const support = await staffLogin("0710000004");
    const approvalsOnly = await staffLogin("0710000007");

    const reg = await call("", "POST", "/api/auth/register", { phone, displayName: "Privacy Tester", passphrase: "a long test passphrase" });
    assert.equal(reg.status, 201);
    const tester = reg.setCookie!.split(";")[0];
    const testerId = reg.data.user.id;

    const order = await call(tester, "POST", "/api/orders", {
      businessId: 1, items: [{ productId: 1, quantity: 1 }], fulfilment: "delivery",
      deliveryAddress: "7 Private Lane, Wrenchville", notes: "Gate code 1234", paymentMethod: "cash",
    }, { "Idempotency-Key": `pv-${run}-1` });
    assert.equal(order.status, 201);

    await check("downloading your data needs your passphrase again", async () => {
      assert.equal((await call(tester, "POST", "/api/privacy/export", { passphrase: "wrong passphrase here" })).status, 401);
    });

    await check("the download holds your own data - and nobody else's", async () => {
      const mine = await call(tester, "POST", "/api/privacy/export", { passphrase: "a long test passphrase" });
      assert.equal(mine.status, 200);
      assert.equal(mine.data.account.phone.slice(-7), phone.slice(-7));
      assert.equal(mine.data.ordersYouPlaced.length, 1);
      assert.equal(mine.data.ordersYouPlaced[0].delivery_address, "7 Private Lane, Wrenchville");
      assert.ok(!mine.text.includes("$2"), "no password hash in the file");
      const other = await call(pieter, "POST", "/api/privacy/export", { passphrase: PASSPHRASE });
      assert.ok(!other.text.includes("Private Lane"), "another user's address never appears");
    });

    await check("a download is tracked as a request, with an audit entry", async () => {
      const reqs = (await call(tester, "GET", "/api/privacy/requests")).data;
      assert.equal(reqs[0].type, "access");
      assert.equal(reqs[0].resolution, "provided");
      const log = await pool.query("SELECT 1 FROM audit_events WHERE action = 'privacy.export' AND actor_user_id = $1", [testerId]);
      assert.equal(log.rowCount, 1);
    });

    await check("you can correct your name; the audit log records which field, not the new value", async () => {
      assert.equal((await call(tester, "PATCH", "/api/privacy/profile", { displayName: "Privacy Tester Two" })).status, 200);
      assert.equal((await call(tester, "GET", "/api/auth/me")).data.user.displayName, "Privacy Tester Two");
      const log = await pool.query("SELECT changes::text AS c FROM audit_events WHERE action = 'privacy.correct' AND actor_user_id = $1", [testerId]);
      assert.ok(log.rows[0].c.includes("display_name") && !log.rows[0].c.includes("Tester Two"));
    });

    await check("other corrections go to support with a 30-day target; one at a time", async () => {
      const r = await call(tester, "POST", "/api/privacy/requests", { type: "correction", details: "My old phone number is wrong on an order." });
      assert.equal(r.status, 201);
      const due = await pool.query("SELECT due_at > now() + interval '29 days' AS ok FROM support_cases WHERE id = $1", [r.data.id]);
      assert.equal(due.rows[0].ok, true);
      assert.equal((await call(tester, "POST", "/api/privacy/requests", { type: "correction", details: "Another correction request." })).status, 409);
    });

    await check("only privacy-authorised staff can see privacy requests", async () => {
      assert.equal((await call(approvalsOnly, "GET", "/api/support/privacy/cases")).status, 403);
      assert.equal((await call(support, "GET", "/api/support/privacy/cases")).status, 200);
    });

    // A waiting application is not a hold - it's simply withdrawn when the account closes.
    assert.equal((await call(tester, "POST", "/api/applications", { type: "courier", vehicleType: "bicycle", area: "Seoding" })).status, 201);

    await check("closing your account needs your passphrase", async () => {
      assert.equal((await call(tester, "POST", "/api/privacy/requests", { type: "deletion", passphrase: "nope nope nope" })).status, 401);
      assert.equal((await call(tester, "POST", "/api/privacy/requests", { type: "deletion", passphrase: "a long test passphrase" })).status, 201);
    });

    const deletionCase = async () =>
      (await call(support, "GET", "/api/support/privacy/cases")).data.find((c: any) => c.type === "deletion" && c.requester.id === testerId && c.status === "open");

    await check("an order still in progress is a lawful hold: the account can't be closed yet", async () => {
      const c = await deletionCase();
      assert.equal(c.holds.length, 1);
      const r = await call(support, "POST", `/api/support/privacy/cases/${c.id}/close-account`, { reason: "Requested by the account holder." });
      assert.equal(r.status, 409);
      assert.match(r.data.holds[0], /in progress/);
    });

    await check("support explains the hold, and the person sees the reason", async () => {
      const c = await deletionCase();
      await call(support, "POST", `/api/support/privacy/cases/${c.id}/hold`, { reason: "You have an order in progress. Ask again once it's finished." });
      const reqs = (await call(tester, "GET", "/api/privacy/requests")).data;
      const d = reqs.find((x: any) => x.type === "deletion");
      assert.equal(d.resolution, "held");
      assert.match(d.reason, /order in progress/);
    });

    await check("once nothing is pending, the account is closed: login details and addresses erased", async () => {
      await call(tester, "POST", `/api/orders/${order.data.id}/cancel`);
      await call(tester, "POST", "/api/privacy/requests", { type: "deletion", passphrase: "a long test passphrase" });
      const c = await deletionCase();
      assert.deepEqual(c.holds, []);
      assert.equal((await call(support, "POST", `/api/support/privacy/cases/${c.id}/close-account`, { reason: "Requested by the account holder." })).status, 200);
      const u = (await pool.query("SELECT phone, password_hash, display_name, closed_at FROM users WHERE id = $1", [testerId])).rows[0];
      assert.equal(u.phone, null);
      assert.equal(u.password_hash, null);
      assert.equal(u.display_name, "Closed account");
      const o = (await pool.query("SELECT delivery_address, notes FROM orders WHERE id = $1", [order.data.id])).rows[0];
      assert.equal(o.delivery_address, "[removed at account closure]");
      assert.equal(o.notes, null);
      const a = (await pool.query("SELECT status, resolution, details FROM support_cases WHERE requester_id = $1 AND case_type = 'courier_application'", [testerId])).rows[0];
      assert.equal(a.resolution, "withdrawn", "a waiting application is withdrawn, not a hold");
      assert.deepEqual(a.details, { erased: true });
    });

    await check("the old session stops working and the passphrase no longer signs in", async () => {
      assert.equal((await call(tester, "GET", "/api/auth/me")).data.user, null);
      const r = await call("", "POST", "/api/auth/login", { phone, passphrase: "a long test passphrase" });
      assert.equal(r.status, 401);
    });

    await check("the order itself is kept for the seller's records, under 'Closed account'", async () => {
      const orders = (await call(seller, "GET", "/api/seller/orders")).data;
      const o = orders.find((x: any) => x.id === order.data.id);
      assert.equal(o.customerName, "Closed account");
    });

    await check("the phone number is free to register again", async () => {
      assert.equal((await call("", "POST", "/api/auth/register", { phone, displayName: "New Person", passphrase: "another long passphrase" })).status, 201);
    });

    await check("retention: delivery addresses go 30 days after an order ends - unless a case holds them", async () => {
      const place = async (key: string) =>
        (await call(thato, "POST", "/api/orders", {
          businessId: 1, items: [{ productId: 2, quantity: 1 }], fulfilment: "delivery",
          deliveryAddress: "12 Old Street", paymentMethod: "cash",
        }, { "Idempotency-Key": `pv-${run}-${key}` })).data.id;
      const oldOrder = await place("old");
      const heldOrder = await place("held");
      for (const id of [oldOrder, heldOrder]) {
        await call(thato, "POST", `/api/orders/${id}/cancel`);
        await pool.query("UPDATE orders SET updated_at = now() - interval '31 days' WHERE id = $1", [id]);
      }
      await pool.query(
        "INSERT INTO support_cases (case_type, requester_id, order_id, details) VALUES ('order_problem', 1, $1, '{}')",
        [heldOrder]
      );
      const counts = await runRetention();
      assert.ok(counts.addressesErased >= 1);
      const addr = async (id: number) => (await pool.query("SELECT delivery_address FROM orders WHERE id = $1", [id])).rows[0].delivery_address;
      assert.equal(await addr(oldOrder), "[removed after 30 days]");
      assert.equal(await addr(heldOrder), "12 Old Street", "kept while a case is open");
    });

    await check("the audit log holds no phone numbers or addresses from these requests", async () => {
      const r = await pool.query(
        "SELECT count(*)::int AS n FROM audit_events WHERE row_to_json(audit_events)::text ILIKE ANY($1)",
        [[`%${phone.slice(1)}%`, "%Private Lane%", "%Gate code%"]]
      );
      assert.equal(r.rows[0].n, 0);
    });

    console.log(`\nTC-20: ${passed} checks PASSED`);
    console.log("Reminder: this added test data. Reset with `npm run db:setup` then `npm run db:seed`.");
  } finally {
    server.close();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(`\nTC-20: FAILED after ${passed} passing checks\n`, err);
  process.exitCode = 1;
});
