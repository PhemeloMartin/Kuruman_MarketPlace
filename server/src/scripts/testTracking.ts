// Tests for delivering to a map pin and following a delivery (like Uber Eats): the customer's pin at
// checkout, directions for whoever delivers, and who may see it.
//
//   npm run test:tracking
//
// Starts its own copy of the API on a spare port and plays every person. It adds orders: run
// `npm run db:setup` and `npm run db:seed` afterwards.

import assert from "assert/strict";
import { AddressInfo } from "net";
import { app } from "../app";
import { pool } from "../db";
import { runRetention } from "../lib/retention";

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

async function check(name: string, fn: () => Promise<void>) {
  await fn();
  passed++;
  console.log(`  PASS  ${name}`);
}

let customer = "";
let seller = "";
let courier = "";

// A spot in Mothibistad, a few km from Kuruman town (inside the delivery area).
const HOME = { lat: -27.3862, lng: 23.4721 };

function order(extra: Record<string, unknown>, businessId = 1, productId = 2) {
  return call(
    customer,
    "POST",
    "/api/orders",
    { businessId, items: [{ productId, quantity: 1 }], paymentMethod: "cash", ...extra },
    { "Idempotency-Key": `track-${run}-${++keyCounter}` }
  );
}

const pinOf = async (orderId: number) =>
  (await pool.query("SELECT delivery_lat AS lat, delivery_lng AS lng FROM orders WHERE id = $1", [orderId])).rows[0];

async function main() {
  const server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  run = Date.now().toString(36);

  try {
    console.log("\nDelivering to a map pin\n");
    customer = await login("0710000001");
    seller = await login("0710000002");
    courier = await login("0710000003");

    let orderId = 0;
    await check("a courier delivery can carry the customer's map pin", async () => {
      const r = await order({ fulfilment: "delivery", deliveryAddress: "House 1234, near the clinic", deliveryLocation: HOME });
      assert.equal(r.status, 201);
      orderId = r.data.id;
      assert.deepEqual(await pinOf(orderId), HOME);
    });

    await check("a pin outside the delivery area, or not a real position, is refused with a clear reason", async () => {
      const far = await order({ fulfilment: "delivery", deliveryAddress: "Somewhere far", deliveryLocation: { lat: -26.2041, lng: 28.0473 } });
      assert.equal(far.status, 422);
      assert.match(far.data.fields.deliveryLocation, /outside the area/);
      const nonsense = await order({ fulfilment: "delivery", deliveryAddress: "House 1", deliveryLocation: { lat: "here", lng: 999 } });
      assert.equal(nonsense.status, 422);
    });

    await check("the pin is optional, and a pickup order never stores one", async () => {
      const noPin = await order({ fulfilment: "delivery", deliveryAddress: "Stand 55, Seoding" });
      assert.equal(noPin.status, 201);
      assert.equal((await pinOf(noPin.data.id)).lat, null);
      const pickup = await order({ fulfilment: "pickup", deliveryLocation: HOME });
      assert.equal(pickup.status, 201);
      assert.equal((await pinOf(pickup.data.id)).lat, null);
    });

    // The seller accepts and packs it; a courier sees the job.
    await call(seller, "POST", `/api/seller/orders/${orderId}/accept`);
    await call(seller, "POST", `/api/seller/orders/${orderId}/ready`);
    const jobId = Number((await pool.query("SELECT id FROM deliveries WHERE order_id = $1", [orderId])).rows[0].id);

    await check("open jobs don't show where the customer lives - only the courier who takes it sees the pin", async () => {
      const open = (await call(courier, "GET", "/api/courier/jobs")).data.find((j: any) => j.id === jobId);
      assert.ok(open, "the job is open");
      assert.equal(JSON.stringify(open).includes(String(HOME.lat)), false);
      assert.equal((await call(courier, "POST", `/api/courier/jobs/${jobId}/claim`)).status, 200);
      const mine = (await call(courier, "GET", "/api/courier/my-jobs")).data.find((j: any) => j.id === jobId);
      assert.equal(mine.orderId, orderId);
      assert.deepEqual(mine.customer.location, HOME);
    });

    await check("the courier gets Google Maps directions: to the shop first, then to the customer's pin", async () => {
      const mine = (await call(courier, "GET", "/api/courier/my-jobs")).data.find((j: any) => j.id === jobId);
      assert.match(mine.business.directionsUrl, /^https:\/\/www\.google\.com\/maps\/dir\/\?api=1&destination=.*Kuruman/);
      assert.ok(mine.customer.directionsUrl.includes(encodeURIComponent(`${HOME.lat},${HOME.lng}`)), mine.customer.directionsUrl);
      assert.match(mine.customer.directionsUrl, /travelmode=driving/, "Pieter rides a motorbike");
    });

    await check("after the delivery, the courier no longer sees the customer's address or pin", async () => {
      await call(seller, "POST", `/api/seller/orders/${orderId}/release`);
      assert.equal((await call(courier, "POST", `/api/courier/jobs/${jobId}/collect`)).status, 200);
      const code = (await call(customer, "POST", `/api/orders/${orderId}/handover-code`)).data.code;
      assert.equal((await call(courier, "POST", `/api/courier/jobs/${jobId}/deliver`, { code })).status, 200);
      const done = (await call(courier, "GET", "/api/courier/my-jobs")).data.find((j: any) => j.id === jobId);
      assert.equal(done.customer, null);
    });

    await check("a shop that delivers itself sees the address, pin and directions - only while delivering", async () => {
      const tumelo = await login("0710000009");
      const p = await pool.query(
        `SELECT b.id AS business_id, p.id AS product_id FROM businesses b JOIN products p ON p.business_id = b.id
          WHERE b.name LIKE 'Tumelo%' AND p.is_active AND p.stock_qty - p.reserved_qty > 2 ORDER BY p.id LIMIT 1`
      );
      const r = await order(
        { fulfilment: "seller_delivery", deliveryAddress: "Plot 7, Batlharos", deliveryLocation: HOME },
        Number(p.rows[0].business_id),
        Number(p.rows[0].product_id)
      );
      assert.equal(r.status, 201);
      const seen = async () => (await call(tumelo, "GET", "/api/seller/orders")).data.find((o: any) => o.id === r.data.id);
      assert.equal((await seen()).deliverTo, null, "not before it's packed");
      await call(tumelo, "POST", `/api/seller/orders/${r.data.id}/accept`);
      await call(tumelo, "POST", `/api/seller/orders/${r.data.id}/ready`);
      const o = await seen();
      assert.equal(o.deliverTo.address, "Plot 7, Batlharos");
      assert.deepEqual(o.deliverTo.location, HOME);
      assert.ok(o.deliverTo.directionsUrl.startsWith("https://www.google.com/maps/dir/"));
      // A courier delivery's address is still not shown to the seller.
      const courierOrder = (await call(seller, "GET", "/api/seller/orders")).data.find((x: any) => x.id === orderId);
      assert.equal(courierOrder.deliverTo, null);
    });

    await check("the pin is erased with the address 30 days after the order ends", async () => {
      await pool.query("UPDATE orders SET updated_at = now() - interval '31 days' WHERE id = $1", [orderId]);
      await runRetention();
      assert.deepEqual(await pinOf(orderId), { lat: null, lng: null });
    });

    console.log(`\nTracking: ${passed} checks PASSED`);
    console.log("Reminder: this added test orders. Reset with `npm run db:setup` then `npm run db:seed`.");
  } finally {
    server.close();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(`\nTracking tests: FAILED after ${passed} passing checks\n`, err);
  process.exitCode = 1;
});
