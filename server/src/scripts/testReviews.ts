// Reviews and Entrepreneur of the Month: only real buyers review, once per order; sellers reply once;
// hidden reviews don't count; the spotlight follows the published formula.
//
//   npm run test:reviews
//
// Uses the demo order history from `npm run db:seed`. It adds reviews and orders: run
// `npm run db:setup` and `npm run db:seed` afterwards.

import assert from "assert/strict";
import { AddressInfo } from "net";
import { app } from "../app";
import { pool } from "../db";

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

async function check(name: string, fn: () => Promise<void>) {
  await fn();
  passed++;
  console.log(`  PASS  ${name}`);
}

async function main() {
  const server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  try {
    console.log("\nReview and spotlight tests\n");
    const lesego = await login("0710000011");
    const thato = await login("0710000001");
    const kgomotso = await login("0710000002");
    const dineo = await login("0710000010");
    const shopId = Number((await pool.query("SELECT id FROM businesses WHERE name LIKE 'Kgomotso%'")).rows[0].id);

    // Lesego's completed order at Kgomotso's that has no review yet (demo history).
    const mine = (await call(lesego, "GET", "/api/orders/mine")).data;
    const unreviewed = mine.find((o: any) => o.status === "completed" && o.canReview);
    assert.ok(unreviewed, "demo data has an unreviewed completed order for Lesego");
    const before = (await call("", "GET", `/api/shops/${shopId}`)).data.rating;

    await check("someone else's order can't be reviewed", async () => {
      assert.equal((await call(thato, "POST", `/api/orders/${unreviewed.id}/review`, { rating: 1 })).status, 404);
    });

    await check("a rating must be 1 to 5 whole stars", async () => {
      assert.equal((await call(lesego, "POST", `/api/orders/${unreviewed.id}/review`, { rating: 6 })).status, 422);
      assert.equal((await call(lesego, "POST", `/api/orders/${unreviewed.id}/review`, { rating: 4.5 })).status, 422);
    });

    await check("the buyer reviews their completed order; the shop's rating includes it", async () => {
      const r = await call(lesego, "POST", `/api/orders/${unreviewed.id}/review`, { rating: 5, comment: "Vetkoek was perfect." });
      assert.equal(r.status, 201);
      const after = (await call("", "GET", `/api/shops/${shopId}`)).data.rating;
      assert.equal(after.count, before.count + 1);
    });

    await check("only one review per order", async () => {
      assert.equal((await call(lesego, "POST", `/api/orders/${unreviewed.id}/review`, { rating: 1 })).status, 409);
    });

    await check("an order that isn't completed can't be reviewed", async () => {
      const o = await call(thato, "POST", "/api/orders", {
        businessId: shopId, items: [{ productId: 1, quantity: 1 }], fulfilment: "pickup", paymentMethod: "cash",
      }, { "Idempotency-Key": `rv-${Date.now()}` });
      assert.equal(o.status, 201);
      assert.equal((await call(thato, "POST", `/api/orders/${o.data.id}/review`, { rating: 5 })).status, 409);
    });

    await check("the public review shows only the first name - no surname or phone number", async () => {
      const shop = await call("", "GET", `/api/shops/${shopId}`);
      const rv = shop.data.reviews.find((x: any) => x.comment === "Vetkoek was perfect.");
      assert.equal(rv.firstName, "Lesego");
      assert.ok(!shop.text.includes("demo customer") && !shop.text.includes("+2771"));
    });

    await check("the seller replies once; other sellers can't reply", async () => {
      const rv = (await call(kgomotso, "GET", "/api/seller/reviews")).data.reviews.find((x: any) => x.comment === "Vetkoek was perfect.");
      assert.equal((await call(dineo, "POST", `/api/seller/reviews/${rv.id}/reply`, { reply: "Not my shop" })).status, 409);
      assert.equal((await call(kgomotso, "POST", `/api/seller/reviews/${rv.id}/reply`, { reply: "Thank you Lesego!" })).status, 200);
      assert.equal((await call(kgomotso, "POST", `/api/seller/reviews/${rv.id}/reply`, { reply: "Again" })).status, 409);
    });

    await check("a review hidden by support no longer counts or shows", async () => {
      const count = (await call("", "GET", `/api/shops/${shopId}`)).data.rating.count;
      await pool.query("UPDATE reviews SET hidden_at = now(), hidden_reason = 'test' WHERE comment = 'Vetkoek was perfect.'");
      const shop = (await call("", "GET", `/api/shops/${shopId}`)).data;
      assert.equal(shop.rating.count, count - 1);
      assert.ok(!shop.reviews.some((x: any) => x.comment === "Vetkoek was perfect."));
    });

    await check("Entrepreneur of the Month follows the formula: the food caravan wins on the demo data", async () => {
      const s = (await call("", "GET", "/api/spotlight")).data.spotlight;
      assert.match(s.business.name, /Dineo/);
      // 50 x 6/6 + 30 x 4.5/5 + 20 x 100% = 97
      assert.equal(s.score, 97);
      assert.match(s.rule, /Only orders placed and completed on the site count/);
    });

    await check("a suspended shop can't be Entrepreneur of the Month", async () => {
      await pool.query("UPDATE businesses SET is_active = FALSE WHERE name LIKE 'Mma Dineo%'");
      const s = (await call("", "GET", "/api/spotlight")).data.spotlight;
      await pool.query("UPDATE businesses SET is_active = TRUE WHERE name LIKE 'Mma Dineo%'");
      assert.ok(!s || !/Dineo/.test(s.business.name));
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
