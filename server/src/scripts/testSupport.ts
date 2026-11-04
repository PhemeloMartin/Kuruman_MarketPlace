// Tests TC-02, TC-21 and TC-22 (spec 11.2): onboarding approval, the restricted support
// console, and the append-only audit log.
//
//   npm run test:support
//
// Starts its own copy of the API on a spare port and acts as each person in turn.
// It changes demo data (approves an application, suspends and reinstates accounts):
// run `npm run db:setup` and `npm run db:seed` afterwards.

// Demo mode: the API hands the SMS code back, so the test can "read the SMS".
process.env.SMS_DEMO_SHOW_CODES = "true";

import assert from "assert/strict";
import crypto from "crypto";
import { AddressInfo } from "net";
import { app } from "../app";
import { pool } from "../db";
import { currentStep, totpCode } from "../lib/totp";
import { processOutbox } from "../lib/notificationWorker";


// A made-up "document" for the tests: a few bytes that start like a PDF (no real ID is ever used).
const fakePdf = () => Buffer.concat([Buffer.from("%PDF-1.4\n"), crypto.randomBytes(200)]).toString("base64");
// A complete courier application: email, ID document, police clearance, a driver's licence when they
// drive, and both agreements.
const courierApplication = (vehicleType: string, area: string) => ({
  type: "courier",
  vehicleType,
  area,
  email: "rider@example.com",
  idDocument: fakePdf(),
  policeClearance: fakePdf(),
  ...(["motorbike", "car", "bakkie"].includes(vehicleType) ? { driversLicence: fakePdf() } : {}),
  agreeTerms: true,
  agreePrivacy: true,
});

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
      // A random number, so reruns don't find the account from last time.
      const phone = "079" + String(Date.now()).slice(-7);
      const sent = await call("", "POST", "/api/auth/code", { phone });
      const r = await call("", "POST", "/api/auth/code/verify", {
        phone, code: sent.data.demoCode, displayName: "Sneaky", role: "support",
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
      assert.equal((await call(seller, "POST", "/api/applications", courierApplication("car", "Wrenchville"))).status, 403);
      const bad = await call(customer, "POST", "/api/applications", { type: "seller", businessName: "", area: "Atlantis" });
      assert.equal(bad.status, 422);
      assert.ok(bad.data.fields.businessName && bad.data.fields.area);
    });

    await check("only one application can wait at a time", async () => {
      const r = await call(applicant, "POST", "/api/applications", courierApplication("car", "Seoding"));
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
      const applied = await call(customer, "POST", "/api/applications", courierApplication("bicycle", "Wrenchville"));
      assert.equal(applied.status, 201);
      await call(support, "POST", `/api/support/applications/${applied.data.id}/reject`, { reason: "We have enough couriers in Wrenchville for now." });
      const mine = await call(customer, "GET", "/api/applications/mine");
      assert.equal(mine.data.application.resolution, "rejected");
      assert.match(mine.data.application.reason, /enough couriers/);
      assert.equal((await call(customer, "GET", "/api/auth/me")).data.user.role, "consumer");
    });

    let lesegoCase = 0;
    let lesego = "";
    await check("a seller is verified like Payfast does it: email, ID document, seller terms and privacy notice", async () => {
      lesego = await login("0710000011");
      const shop = { type: "seller", businessName: "Lesego's Sewing", area: "Seoding", pickupAddress: "12 Church Street, Seoding", phone: "0821234567" };
      const missing = await call(lesego, "POST", "/api/applications", shop);
      assert.equal(missing.status, 422);
      for (const f of ["email", "idDocument", "agreeTerms", "agreePrivacy"]) assert.ok(missing.data.fields[f], `${f} required`);
      const pdf = Buffer.concat([Buffer.from("%PDF-1.4\n"), crypto.randomBytes(300)]).toString("base64");
      const full = { ...shop, email: "Lesego@Example.com", idDocument: pdf, agreeTerms: true, agreePrivacy: true };
      const notAnId = await call(lesego, "POST", "/api/applications", { ...full, idDocument: Buffer.from("just some text").toString("base64") });
      assert.equal(notAnId.status, 422, "only a photo or PDF counts as an ID document");
      const r = await call(lesego, "POST", "/api/applications", full);
      assert.equal(r.status, 201);
      lesegoCase = r.data.id;
      const stored = (await pool.query("SELECT data_enc FROM verification_documents WHERE case_id = $1", [lesegoCase])).rows[0];
      assert.ok(!stored.data_enc.includes(Buffer.from("%PDF").toString("base64url")), "stored encrypted, not as the file itself");
      const app = (await call(support, "GET", "/api/support/applications")).data.find((a: any) => a.id === lesegoCase);
      assert.deepEqual(app.documents, ["id_document"]);
      assert.equal(app.details.email, "lesego@example.com");
      assert.equal(app.details.termsVersion, "2026-11-04");
      assert.equal(app.details.privacyVersion, "2026-11-04");
    });

    await check("only approvers can open the ID document, and every opening is in the audit log", async () => {
      const open = (cookie: string) => fetch(`${base}/api/support/applications/${lesegoCase}/documents/id_document`, { headers: { Cookie: cookie } });
      assert.equal((await open(customer)).status, 403);
      const r = await open(support);
      assert.equal(r.status, 200);
      assert.equal(r.headers.get("content-type"), "application/pdf");
      assert.equal(Buffer.from(await r.arrayBuffer()).subarray(0, 5).toString(), "%PDF-");
      const log = await pool.query("SELECT 1 FROM audit_events WHERE action = 'application.view_document' AND resource_id = $1", [String(lesegoCase)]);
      assert.equal(log.rowCount, 1);
    });

    const trailOf = async (id: number) => (await call(support, "GET", "/api/support/applications")).data.find((a: any) => a.id === id).trail;

    await check("a trail of contact: the seller gets a 'received' email, and support can write to them", async () => {
      const first = (await trailOf(lesegoCase))[0];
      assert.equal(first.kind, "email");
      assert.match(first.subject, /We received your application/);
      assert.match(first.body, /Please don't send documents by email/);
      assert.equal((await call(customer, "POST", `/api/support/applications/${lesegoCase}/email`, { message: "Hello there" })).status, 403);
      assert.equal((await call(support, "POST", `/api/support/applications/${lesegoCase}/email`, { message: "Hi" })).status, 422);
      const r = await call(support, "POST", `/api/support/applications/${lesegoCase}/email`, {
        message: "Your ID photo is blurry. Please upload a clearer one under Profile.",
      });
      assert.equal(r.status, 200);
      const sent = (await trailOf(lesegoCase))[1];
      assert.match(sent.body, /blurry/);
      assert.equal(sent.by, "Support (demo)");
    });

    await check("a seller who sent the wrong ID document replaces it themselves - never by email", async () => {
      // (Lesego is still signed in from above: the site allows only a few sign-ins per 15 minutes.)
      const wrong = await call(lesego, "PUT", "/api/applications/mine/documents/id_document", { file: Buffer.from("not a file").toString("base64") });
      assert.equal(wrong.status, 422);
      const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), crypto.randomBytes(100)]).toString("base64");
      assert.equal((await call(lesego, "PUT", "/api/applications/mine/documents/drivers_licence", { file: png })).status, 404, "not a document sellers need");
      assert.equal((await call(lesego, "PUT", "/api/applications/mine/documents/id_document", { file: png })).status, 200);
      const doc = await fetch(`${base}/api/support/applications/${lesegoCase}/documents/id_document`, { headers: { Cookie: support } });
      assert.equal(doc.headers.get("content-type"), "image/png", "the new document replaced the old one");
      const trail = await trailOf(lesegoCase);
      assert.match(trail[trail.length - 1].body, /uploaded a new ID document/);
    });

    await check("the decision is emailed to the seller too, and kept in the trail", async () => {
      const r = await call(support, "POST", `/api/support/applications/${lesegoCase}/reject`, { reason: "Please apply with your business's own phone number." });
      assert.equal(r.status, 200);
      const last = (await trailOf(lesegoCase)).at(-1);
      assert.match(last.subject, /About your application/);
      assert.match(last.body, /business's own phone number/);
    });

    await check("couriers are verified too: ID and police clearance always, a driver's licence when they drive", async () => {
      const anna = await login("0710000012");
      const missing = await call(anna, "POST", "/api/applications", { type: "courier", vehicleType: "car", area: "Seoding" });
      assert.equal(missing.status, 422);
      for (const f of ["email", "idDocument", "driversLicence", "policeClearance", "agreeTerms", "agreePrivacy"]) assert.ok(missing.data.fields[f], `${f} required`);
      const onBicycle = await call(anna, "POST", "/api/applications", { type: "courier", vehicleType: "bicycle", area: "Seoding" });
      assert.ok(!onBicycle.data.fields.driversLicence, "no licence needed on a bicycle");
      const r = await call(anna, "POST", "/api/applications", courierApplication("car", "Seoding"));
      assert.equal(r.status, 201);
      const app = (await call(support, "GET", "/api/support/applications")).data.find((a: any) => a.id === r.data.id);
      assert.deepEqual(app.documents, ["id_document", "drivers_licence", "police_clearance"]);
      const pcc = await fetch(`${base}/api/support/applications/${r.data.id}/documents/police_clearance`, { headers: { Cookie: support } });
      assert.equal(pcc.status, 200);
      assert.equal(pcc.headers.get("content-type"), "application/pdf");
      assert.match((await trailOf(r.data.id))[0].subject, /application to deliver/);
      const log = await pool.query("SELECT changes FROM audit_events WHERE action = 'application.view_document' ORDER BY id DESC LIMIT 1");
      assert.equal(log.rows[0].changes.kind, "police_clearance");
    });

    let ticketId = 0;
    await check("anyone signed in opens a help ticket and follows it on the site; nobody else can read it", async () => {
      const ticket = { topic: "order", subject: "Wrong items in my bag", message: "I ordered spinach but got onions. Order KMP-000123." };
      assert.equal((await call("", "POST", "/api/tickets", ticket)).status, 401);
      const bad = await call(customer, "POST", "/api/tickets", { topic: "x", subject: "", message: "" });
      assert.equal(bad.status, 422);
      assert.ok(bad.data.fields.topic && bad.data.fields.subject && bad.data.fields.message);
      const r = await call(customer, "POST", "/api/tickets", ticket);
      assert.equal(r.status, 201);
      ticketId = r.data.id;
      const mine = (await call(customer, "GET", "/api/tickets")).data;
      assert.equal(mine[0].id, ticketId);
      assert.equal(mine[0].status, "open");
      const someoneElse = seller; // any other signed-in person
      assert.equal((await call(someoneElse, "GET", `/api/tickets/${ticketId}`)).status, 404);
    });

    await check("support answers in the ticket; the person gets a notification and an SMS with the link", async () => {
      assert.equal((await call(customer, "GET", "/api/support/tickets")).status, 403);
      const list = (await call(support, "GET", "/api/support/tickets")).data;
      const t = list.find((x: any) => x.id === ticketId);
      assert.equal(t.status, "open");
      assert.match(t.person.name, /Thato/);
      assert.ok(!JSON.stringify(list).includes("+2771"), "support's ticket list shows no phone numbers");
      assert.equal((await call(support, "POST", `/api/support/tickets/${ticketId}/messages`, { message: "Sorry! The seller will swap them today." })).status, 201);
      await processOutbox();
      const mine = (await call(customer, "GET", `/api/tickets/${ticketId}`)).data;
      assert.equal(mine.status, "answered");
      assert.equal(mine.messages[1].author, "KurumanMarketPlace support");
      const notes = (await call(customer, "GET", "/api/notifications")).data;
      assert.ok(notes.some((n: any) => n.template === "ticket.answered" && n.args.ticketId === ticketId));
      const sms = await pool.query("SELECT body FROM sms_messages WHERE phone = '+27710000001' ORDER BY id DESC LIMIT 1");
      assert.match(sms.rows[0].body, new RegExp(`question #${ticketId} .*/help/${ticketId}$`));
      assert.ok(sms.rows[0].body.length <= 160, "fits in one SMS");
    });

    await check("the person replies or closes it; a closed ticket takes no more messages", async () => {
      assert.equal((await call(customer, "POST", `/api/tickets/${ticketId}/messages`, { message: "Thank you, all sorted." })).status, 201);
      assert.equal((await call(customer, "GET", `/api/tickets/${ticketId}`)).data.status, "open");
      assert.equal((await call(customer, "POST", `/api/tickets/${ticketId}/close`)).status, 200);
      assert.equal((await call(customer, "POST", `/api/tickets/${ticketId}/messages`, { message: "One more thing" })).status, 409);
      assert.equal((await call(support, "POST", `/api/support/tickets/${ticketId}/messages`, { message: "Anything else?" })).status, 409);
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
