// Collection-only items, the seller's WhatsApp button, barcodes and WhatsApp link previews.
//
//   npm run test:sharing
//
// Uses the demo data from `npm run db:seed`, and adds orders: run `npm run db:setup` and
// `npm run db:seed` afterwards.

import assert from "assert/strict";
import { AddressInfo } from "net";
import { app } from "../app";
import { pool } from "../db";
import { previewTags } from "../lib/linkPreview";

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
  return { status: res.status, data: text ? JSON.parse(text) : null };
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
    console.log("\nCollection-only, WhatsApp, barcode and link-preview tests\n");
    const thato = await login("0710000001");
    const tumelo = await login("0710000009");
    const cement = (await pool.query("SELECT id, business_id FROM products WHERE name = 'Cement'")).rows[0];
    const order = (fulfilment: string) =>
      call(thato, "POST", "/api/orders", {
        businessId: Number(cement.business_id),
        items: [{ productId: Number(cement.id), quantity: 1 }],
        fulfilment,
        deliveryAddress: fulfilment === "delivery" ? "12 Main Street, Kuruman" : undefined,
        paymentMethod: "cash",
      }, { "Idempotency-Key": `share-${fulfilment}-${Date.now()}` });

    await check("a collection-only item can't be ordered for delivery - the server refuses it", async () => {
      const r = await order("delivery");
      assert.equal(r.status, 422);
      assert.match(r.data.error, /Cement must be collected/);
    });

    await check("the same item can be ordered for pickup", async () => {
      assert.equal((await order("pickup")).status, 201);
    });

    await check("the catalogue tells the app which items are collection only", async () => {
      const p = (await call("", "GET", `/api/products/${cement.id}`)).data;
      assert.equal(p.collectionOnly, true);
    });

    await check("a seller's WhatsApp number must be a real SA number, and is stored in one format", async () => {
      assert.equal((await call(tumelo, "PATCH", "/api/seller/shop", { whatsappPhone: "12345" })).status, 422);
      assert.equal((await call(tumelo, "PATCH", "/api/seller/shop", { whatsappPhone: "071 999 1234" })).status, 200);
      const shop = (await call("", "GET", `/api/shops/${cement.business_id}`)).data;
      assert.equal(shop.whatsapp, "+27719991234");
    });

    await check("an empty number removes the WhatsApp button", async () => {
      assert.equal((await call(tumelo, "PATCH", "/api/seller/shop", { whatsappPhone: "" })).status, 200);
      assert.equal((await call("", "GET", `/api/shops/${cement.business_id}`)).data.whatsapp, null);
    });

    await check("a barcode can be on only one of the seller's products; nonsense isn't accepted", async () => {
      const sand = (await pool.query("SELECT id FROM products WHERE name = 'Building sand'")).rows[0];
      assert.equal((await call(tumelo, "PATCH", `/api/seller/products/${sand.id}`, { barcode: "6009876500025" })).status, 409);
      assert.equal((await call(tumelo, "PATCH", `/api/seller/products/${sand.id}`, { barcode: "<b>!</b>" })).status, 422);
      assert.equal((await call(tumelo, "PATCH", `/api/seller/products/${sand.id}`, { barcode: "6001111100018" })).status, 200);
    });

    await check("a shared product link gets a WhatsApp preview: name, price and shop", async () => {
      const tags = await previewTags(`/product/${cement.id}`);
      assert.match(tags, /og:title" content="Cement - R110.00"/);
      assert.match(tags, /Tumelo&#39;s Build &amp; Farm Supplies/);
      assert.match(tags, /og:image" content="http/);
    });

    await check("previews never leak hidden products, and other pages get none", async () => {
      await pool.query("UPDATE products SET is_active = FALSE WHERE id = $1", [cement.id]);
      assert.equal(await previewTags(`/product/${cement.id}`), "");
      await pool.query("UPDATE products SET is_active = TRUE WHERE id = $1", [cement.id]);
      assert.equal(await previewTags("/orders"), "");
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
