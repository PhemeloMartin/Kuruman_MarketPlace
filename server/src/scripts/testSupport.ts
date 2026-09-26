// Tests TC-02, TC-21 and TC-22 (spec 11.2): onboarding approval, the restricted support
// console, and the append-only audit log.
//
//   npm run test:support
//
// Starts its own copy of the API on a spare port and acts as each person in turn.
// It changes demo data (approves an application, suspends and reinstates accounts):
// run `npm run db:setup` and `npm run db:seed` afterwards.

import assert from "assert/strict";
import { AddressInfo } from "net";
import { app } from "../app";
import { pool } from "../db";
import { currentStep, totpCode } from "../lib/totp";

const ORIGIN = "http://localhost:5173";
const PASSPHRASE = "Kuruman Oasis 2026";
let base = "";
let passed = 0;

async function call(cookie: string, method: string, path: string, body?: unknown) {
  const res = await fetch(base + path, {
    method,
    headers: { Origin: ORIGIN, Cookie: cookie, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null, setCookie: res.headers.get("set-cookie") };
}

async function login(phone: string): Promise<string> {
  const r = await call("", "POST", "/api/auth/login", { phone, passphrase: PASSPHRASE });
  assert.equal(r.status, 200, `login ${phone}`);
  return r.setCookie!.split(";")[0];
}

async function check(name: string, fn: () => Promise<void>) {
  await fn();
  passed++;
  console.log(`  PASS  ${name}`);
}

// Plays the staff member's authenticator app: sets it up and enters the current code.
async function enrolAndVerify(cookie: string): Promise<string> {
  const setup = await call(cookie, "POST", "/api/support/mfa/setup");
  assert.equal(setup.status, 200, "mfa setup");
  const code = totpCode(setup.data.secret, currentStep());
  const v = await call(cookie, "POST", "/api/support/mfa/verify", { code });
  assert.equal(v.status, 200, "mfa verify");
  return setup.data.secret;
}

async function main() {
  const server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  try {
    console.log("\nTC-02 / TC-21 / TC-22 support console tests\n");

    await check("one-time codes match the RFC 6238 published test value", async () => {
      // RFC 6238 Appendix B: secret "12345678901234567890", time 59 s -> 94287082 (last 6 digits: 287082).
      const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"; // that secret in base32
      assert.equal(totpCode(secret, 1), "287082");
    });

    await check("sign-up can't create staff: a 'support' role sent by the browser is ignored", async () => {
      const r = await call("", "POST", "/api/auth/register", {
        phone: "0719990001", displayName: "Sneaky", passphrase: "trying to become staff", role: "support",
      });
      assert.equal(r.status, 201);
      assert.equal(r.data.user.role, "consumer");
    });

    const customer = await login("0710000001");
    const seller = await login("0710000002");
    const courier = await login("0710000003");
    let support = await login("0710000004");
    const approvalsOnly = await login("0710000007");
    const applicant = await login("0710000008");

    await check("customers can't open the support console", async () => {
      const r = await call(customer, "GET", "/api/support/applications");
      assert.equal(r.status, 403);
    });

    await check("support staff with only a passphrase are refused until they enter an authenticator code", async () => {
      const r = await call(support, "GET", "/api/support/applications");
      assert.equal(r.status, 403);
      assert.equal(r.data.code, "mfa_required");
    });

    let secret = "";
    await check("a wrong authenticator code is refused; the right one unlocks this session", async () => {
      const setup = await call(support, "POST", "/api/support/mfa/setup");
      secret = setup.data.secret;
      const wrong = String((Number(totpCode(secret, currentStep())) + 1) % 1_000_000).padStart(6, "0");
      assert.equal((await call(support, "POST", "/api/support/mfa/verify", { code: wrong })).status, 401);
      const right = totpCode(secret, currentStep());
      assert.equal((await call(support, "POST", "/api/support/mfa/verify", { code: right })).status, 200);
      assert.equal((await call(support, "GET", "/api/support/applications")).status, 200);
    });

    await check("a code that was already used can't be used again (new session, same code)", async () => {
      const again = await login("0710000004");
      const used = totpCode(secret, currentStep());
      const r = await call(again, "POST", "/api/support/mfa/verify", { code: used });
      assert.equal(r.status, 401);
    });

    await check("the authenticator secret is stored encrypted, not as plain text", async () => {
      const r = await pool.query("SELECT totp_secret_enc FROM users WHERE phone = '+27710000004'");
      assert.ok(r.rows[0].totp_secret_enc);
      assert.ok(!r.rows[0].totp_secret_enc.includes(secret));
    });

    await enrolAndVerify(approvalsOnly);
    await check("scopes are enforced: an approvals-only staff member can't read the audit log", async () => {
      assert.equal((await call(approvalsOnly, "GET", "/api/support/applications")).status, 200);
      const r = await call(approvalsOnly, "GET", "/api/support/audit");
      assert.equal(r.status, 403);
      assert.equal(r.data.code, "scope");
    });

    await check("sellers and couriers can't apply again; applications are validated", async () => {
      assert.equal((await call(seller, "POST", "/api/applications", { type: "courier", vehicleType: "car", area: "Wrenchville" })).status, 403);
      const bad = await call(customer, "POST", "/api/applications", { type: "seller", businessName: "", area: "Atlantis" });
      assert.equal(bad.status, 422);
      assert.ok(bad.data.fields.businessName && bad.data.fields.area);
    });

    await check("only one application can wait at a time", async () => {
      const r = await call(applicant, "POST", "/api/applications", { type: "courier", vehicleType: "car", area: "Seoding" });
      assert.equal(r.status, 409);
    });

    const list = await call(support, "GET", "/api/support/applications");
    const waiting = list.data.find((a: any) => a.status === "open" && a.applicant.phone === "+27710000008");

    await check("a decision needs a written reason", async () => {
      const r = await call(support, "POST", `/api/support/applications/${waiting.id}/approve`, { reason: "" });
      assert.equal(r.status, 422);
    });

    await check("approval makes the applicant a seller with their business, in one step", async () => {
      const r = await call(support, "POST", `/api/support/applications/${waiting.id}/approve`, { reason: "Checked business details by phone." });
      assert.equal(r.status, 200);
      const me = await call(applicant, "GET", "/api/auth/me");
      assert.equal(me.data.user.role, "entrepreneur");
      const dash = await call(applicant, "GET", "/api/seller/dashboard");
      assert.equal(dash.status, 200);
      assert.equal(dash.data.business.name, "Boitumelo's Kitchen (demo)");
    });

    await check("the same application can't be decided twice", async () => {
      const r = await call(support, "POST", `/api/support/applications/${waiting.id}/reject`, { reason: "Changed my mind" });
      assert.equal(r.status, 409);
    });

    await check("a rejected applicant sees the reason", async () => {
      const applied = await call(customer, "POST", "/api/applications", { type: "courier", vehicleType: "bicycle", area: "Wrenchville" });
      assert.equal(applied.status, 201);
      await call(support, "POST", `/api/support/applications/${applied.data.id}/reject`, { reason: "We have enough couriers in Wrenchville for now." });
      const mine = await call(customer, "GET", "/api/applications/mine");
      assert.equal(mine.data.application.resolution, "rejected");
      assert.match(mine.data.application.reason, /enough couriers/);
      assert.equal((await call(customer, "GET", "/api/auth/me")).data.user.role, "consumer");
    });

    await check("a suspended shop disappears from the catalogue and can't list products", async () => {
      const before = (await call("", "GET", "/api/products")).data.filter((p: any) => p.business.id === 1).length;
      assert.ok(before > 0);
      assert.equal((await call(support, "POST", "/api/support/businesses/1/suspend", { reason: "Complaint under review." })).status, 200);
      const after = (await call("", "GET", "/api/products")).data.filter((p: any) => p.business.id === 1).length;
      assert.equal(after, 0);
      const add = await call(seller, "POST", "/api/seller/products", {
        name: "Test", unitLabel: "1 item", priceCents: 1000, stockQty: 1, category: "pantry",
      });
      assert.equal(add.status, 403);
      assert.equal((await call(seller, "GET", "/api/seller/orders")).status, 200, "can still see and finish orders");
      assert.equal((await call(support, "POST", "/api/support/businesses/1/reinstate", { reason: "Resolved with the customer." })).status, 200);
      const back = (await call("", "GET", "/api/products")).data.filter((p: any) => p.business.id === 1).length;
      assert.equal(back, before);
    });

    await check("a suspended courier can't see or take new jobs", async () => {
      const userId = (await call(courier, "GET", "/api/auth/me")).data.user.id;
      await call(support, "POST", `/api/support/couriers/${userId}/suspend`, { reason: "Missing cash remittance." });
      assert.equal((await call(courier, "GET", "/api/courier/jobs")).status, 403);
      await call(support, "POST", `/api/support/couriers/${userId}/reinstate`, { reason: "Cash handed over." });
      assert.equal((await call(courier, "GET", "/api/courier/jobs")).status, 200);
    });

    await check("every decision is in the audit log, with who, what and why", async () => {
      const r = await call(support, "GET", "/api/support/audit");
      const actions = r.data.map((a: any) => a.action);
      for (const a of ["application.approve", "application.reject", "business.suspend", "business.reinstate", "courier.suspend", "mfa.enrol"]) {
        assert.ok(actions.includes(a), `missing ${a}`);
      }
      const approve = r.data.find((a: any) => a.action === "application.approve");
      assert.equal(approve.actorName, "Support (demo)");
      assert.match(approve.reason, /Checked business details/);
    });

    await check("the audit log holds no passphrases or authenticator codes", async () => {
      const r = await pool.query("SELECT count(*)::int AS n FROM audit_events WHERE row_to_json(audit_events)::text ILIKE $1", [`%${PASSPHRASE}%`]);
      assert.equal(r.rows[0].n, 0);
    });

    await check("the database refuses to change or delete audit history", async () => {
      await assert.rejects(pool.query("UPDATE audit_events SET reason = 'edited'"), /append-only/);
      await assert.rejects(pool.query("DELETE FROM audit_events"), /append-only/);
      await assert.rejects(pool.query("TRUNCATE audit_events"), /append-only/);
    });

    console.log(`\nTC-02 / TC-21 / TC-22: ${passed} checks PASSED`);
    console.log("Reminder: this changed demo data. Reset with `npm run db:setup` then `npm run db:seed`.");
  } finally {
    server.close();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(`\nSupport tests: FAILED after ${passed} passing checks\n`, err);
  process.exitCode = 1;
});
