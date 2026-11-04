// Tests for SMS in the person's language (English, Setswana, Afrikaans), and that every SMS text fits in one
// SMS: at most 160 characters, in the basic SMS alphabet (one Unicode character would make it cost 2-3 SMS).
//
//   npm run test:sms
//
// Starts its own copy of the API on a spare port. It adds orders and changes demo accounts' languages: run
// `npm run db:setup` and `npm run db:seed` afterwards.

process.env.SMS_DEMO_SHOW_CODES = "true";

import assert from "assert/strict";
import { AddressInfo } from "net";
import { app } from "../app";
import { pool } from "../db";
import { processOutbox } from "../lib/notificationWorker";
import { codeLanguage } from "../lib/phoneCodes";
import { SMS_KEYS, smsSize, smsText } from "../lib/smsText";

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

// Long but realistic values, so the length check is honest.
const LONG = {
  order: "KMP-123456",
  shop: "Mma Kefilwe's Vegetable Stall",
  total: "R1234.56",
  minutes: 30,
  link: "https://kurumanmarketplace.co.za/orders",
  customer: "Tshegofatso",
  name: "Tshegofatso",
  items: "2 x Morogo (bunch), 1 x Tomatoes",
  ticketId: 1234,
  subject: "My order came without the tomatoes",
  why: " (Sold out today, sorry)",
  code: "123456",
  purpose: "sign_in",
  retry: true,
  pickup: true,
  cash: true,
};

// The link each SMS really carries (most go to Your orders).
const SITE = "https://kurumanmarketplace.co.za";
const LINK: Partial<Record<string, string>> = {
  "order.on_the_way": `${SITE}/orders/123456/track`,
  "courier.outside": `${SITE}/orders/123456/track`,
  "ticket.answered": `${SITE}/help/1234`,
};

const lastSmsTo = async (phone: string) =>
  (await pool.query("SELECT body FROM sms_messages WHERE phone = $1 AND direction = 'out' ORDER BY id DESC LIMIT 1", [phone])).rows[0]?.body ?? "";

async function main() {
  const server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  try {
    console.log("\nSMS in three languages\n");

    await check("every SMS, in every language, fits in ONE SMS and uses only the basic SMS alphabet", async () => {
      for (const key of SMS_KEYS) {
        for (const lang of ["en", "tn", "af"]) {
          for (const variant of [LONG, { ...LONG, purpose: "confirm", retry: false, pickup: false, cash: false }]) {
            // The stall's new-order SMS lists every item: checked with one (more items may take two SMS).
            const items = key === "stall.new_order" ? "1 x Morogo (bunch)" : variant.items;
            const text = smsText(key, lang, { ...variant, items, link: LINK[key] ?? variant.link });
            const size = smsSize(text);
            assert.ok(size.gsm7, `${key} (${lang}) has a character outside the SMS alphabet: ${text}`);
            assert.ok(size.units <= 160, `${key} (${lang}) is ${size.units} characters: ${text}`);
          }
        }
      }
    });

    await check("the three languages really differ, and an unknown language falls back to English", async () => {
      const args = { order: "KMP-000001", shop: "Shop", total: "R10.00", minutes: 15, link: "x" };
      const texts = ["en", "tn", "af"].map((l) => smsText("order.pay_now", l, args));
      assert.equal(new Set(texts).size, 3);
      assert.equal(smsText("order.pay_now", "zu", args), texts[0]);
      assert.equal(smsText("order.pay_now", null, args), texts[0]);
    });

    const thato = await login("0710000001");
    const seller = await login("0710000002");
    const order = async (fulfilment = "pickup") =>
      (
        await call(thato, "POST", "/api/orders", { businessId: 1, items: [{ productId: 2, quantity: 1 }], fulfilment, paymentMethod: "cash" }, {
          "Idempotency-Key": `sms-${Date.now()}-${Math.floor(Math.random() * 1e9)}`,
        })
      ).data.id as number;

    await check("a customer who chose Setswana gets their order SMS in Setswana", async () => {
      assert.equal((await call(thato, "PATCH", "/api/privacy/profile", { preferredLanguage: "tn" })).status, 200);
      const id = await order();
      await call(seller, "POST", `/api/seller/orders/${id}/accept`);
      await processOutbox();
      assert.match(await lastSmsTo("+27710000001"), /e amogetswe ke Kgomotso's Fresh Corner/);
    });

    await check("...and after switching to Afrikaans, the next SMS is in Afrikaans", async () => {
      await call(thato, "PATCH", "/api/privacy/profile", { preferredLanguage: "af" });
      const id = Number((await pool.query("SELECT id FROM orders WHERE consumer_id = (SELECT id FROM users WHERE phone = '+27710000001') ORDER BY id DESC LIMIT 1")).rows[0].id);
      await call(seller, "POST", `/api/seller/orders/${id}/ready`);
      await processOutbox();
      assert.match(await lastSmsTo("+27710000001"), /gereed om by Kgomotso's Fresh Corner.* af te haal/);
    });

    await check("a stall owner who chose Setswana gets the new-order SMS and our replies in Setswana", async () => {
      const stall = (await pool.query("SELECT id, phone, owner_id FROM businesses WHERE kind = 'market_stall'")).rows[0];
      await pool.query("UPDATE users SET preferred_language = 'tn' WHERE id = $1", [stall.owner_id]);
      const morogo = (await pool.query("SELECT id FROM products WHERE business_id = $1 ORDER BY id LIMIT 1", [stall.id])).rows[0];
      const r = await call(thato, "POST", "/api/orders", { businessId: Number(stall.id), items: [{ productId: Number(morogo.id), quantity: 1 }], fulfilment: "pickup", paymentMethod: "cash" }, {
        "Idempotency-Key": `sms-stall-${Date.now()}`,
      });
      assert.equal(r.status, 201);
      await processOutbox();
      assert.match(await lastSmsTo(stall.phone), /Thato o batla 1 x .* Araba 1 go amogela, 2 fa di fedile/);
      const reply = await call("", "POST", "/api/demo/phone", { number: "0" + String(stall.phone).slice(3), text: "1" });
      assert.match(reply.data.reply, /e amogetswe\. Moreki o tla go bontsha khoutu/);
      const help = await call("", "POST", "/api/demo/phone", { number: "0" + String(stall.phone).slice(3), text: "hello?" });
      assert.match(help.data.reply, /araba 1 go amogela odara e ntsha/);
    });

    await check("the sign-in code SMS goes in the account's language - or, for a new number, the site's", async () => {
      assert.equal(await codeLanguage("+27710000001", "en"), "af", "Thato's account says Afrikaans");
      assert.equal(await codeLanguage("+27829990000", "tn"), "tn", "no account yet: the site's language");
      assert.equal(await codeLanguage("+27829990000", "xx"), "en");
      assert.match(smsText("code", "tn", { purpose: "sign_in", code: "123456", minutes: 10 }), /khoutu ya gago ya go tsena ke 123456/);
    });

    await check("someone signing up with the site in Afrikaans gets an Afrikaans account", async () => {
      const phone = "0829990001";
      const code = (await call("", "POST", "/api/auth/code", { phone, language: "af" })).data.demoCode;
      assert.ok(code, "the demo shows the code");
      const v = await call("", "POST", "/api/auth/code/verify", { phone, code, displayName: "Annelie Test", preferredLanguage: "af" });
      assert.equal(v.status, 201, "a new account");
      assert.equal(v.data.user.preferredLanguage, "af");
    });

    console.log(`\nSMS languages: ${passed} checks PASSED`);
    console.log("Reminder: this changed demo data. Reset with `npm run db:setup` then `npm run db:seed`.");
  } finally {
    server.close();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(`\nSMS language tests: FAILED after ${passed} passing checks\n`, err);
  process.exitCode = 1;
});
