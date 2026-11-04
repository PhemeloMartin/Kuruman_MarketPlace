// Tests for delivering to a map pin and following a delivery (like Uber Eats): the customer's pin at
// checkout, directions for whoever delivers, the courier's live position, the chat and "I'm outside", and
// who may see what.
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
import { processOutbox } from "../lib/notificationWorker";

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
    let noPinOrder = 0;
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
      noPinOrder = noPin.data.id;
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

    const tracking = async (cookie = customer, id = orderId) => call(cookie, "GET", `/api/orders/${id}/tracking`);

    await check("a courier with no delivery on the go can't share a location (so nothing is kept)", async () => {
      const lerato = await login("0710000006");
      const r = await call(lerato, "POST", "/api/courier/location", { lat: -27.45, lng: 23.43 });
      assert.equal(r.status, 409);
      assert.equal(r.data.sharing, false);
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM courier_locations")).rows[0].n, 0);
    });

    await check("while collecting, the customer sees the courier on the map (no distance until they have the order)", async () => {
      assert.equal((await call(courier, "POST", "/api/courier/location", { lat: -27.4524, lng: 23.4325, accuracy: 12 })).status, 200);
      const t = (await tracking()).data;
      assert.equal(t.status, "ready");
      assert.equal(t.delivery.status, "claimed");
      assert.deepEqual(t.delivery.courier, { name: "Pieter", vehicleType: "motorbike" }, "first name only");
      assert.equal(t.delivery.courierLocation.lat, -27.4524);
      assert.ok(t.delivery.courierLocation.secondsAgo < 5);
      assert.equal(t.delivery.distanceKm, null);
      assert.deepEqual(t.destination.location, HOME);
    });

    const messages = async (cookie: string, id = orderId) => call(cookie, "GET", `/api/orders/${id}/messages`);
    const notificationsOf = async (cookie: string) => (await call(cookie, "GET", "/api/notifications")).data;

    await check("the customer and the courier can message each other while it's being delivered", async () => {
      assert.equal((await call(customer, "POST", `/api/orders/${noPinOrder}/messages`, { text: "Hello?" })).status, 409, "no courier yet");
      assert.equal((await call(customer, "POST", `/api/orders/${orderId}/messages`, { text: "   " })).status, 422);
      assert.equal((await call(customer, "POST", `/api/orders/${orderId}/messages`, { text: "I'm at the blue gate" })).status, 201);
      const job = (await call(courier, "GET", "/api/courier/my-jobs")).data.find((j: any) => j.id === jobId);
      assert.equal(job.unreadMessages, 1);
      const chat = (await messages(courier)).data;
      assert.equal(chat.otherName, "Thato");
      assert.deepEqual(chat.messages.map((m: any) => [m.mine, m.text]), [[false, "I'm at the blue gate"]]);
      assert.equal((await call(courier, "GET", "/api/courier/my-jobs")).data.find((j: any) => j.id === jobId).unreadMessages, 0, "opening it marks it read");
      assert.equal((await call(courier, "POST", `/api/orders/${orderId}/messages`, { text: "On my way to the shop" })).status, 201);
      const t = (await tracking()).data;
      assert.equal(t.unreadMessages, 1);
      assert.equal(t.canMessage, true);
      assert.equal(t.canCall, false, "calls once the order is on its way");
    });

    await check("nobody else can read or write in that chat", async () => {
      const lesego = await login("0710000011");
      assert.equal((await messages(lesego)).status, 404);
      assert.equal((await call(lesego, "POST", `/api/orders/${orderId}/messages`, { text: "hi" })).status, 404);
      assert.equal((await messages(seller)).status, 404, "not even the seller");
    });

    await check("an unread message becomes a notification (one already seen doesn't)", async () => {
      await processOutbox();
      const forCustomer = (await notificationsOf(customer)).filter((n: any) => n.template === "delivery.message");
      assert.equal(forCustomer.length, 1);
      assert.equal(forCustomer[0].args.from, "Pieter");
      assert.equal(forCustomer[0].args.forCustomer, true);
      assert.equal(forCustomer[0].orderId, orderId);
      const forCourier = (await notificationsOf(courier)).filter((n: any) => n.template === "delivery.message");
      assert.equal(forCourier.length, 0, "Pieter had already read Thato's message");
    });

    await check("on the way: how far away the courier is, and about how long they'll be", async () => {
      await call(seller, "POST", `/api/seller/orders/${orderId}/release`);
      assert.equal((await call(courier, "POST", `/api/courier/jobs/${jobId}/collect`)).status, 200);
      // Kuruman town to Mothibistad is about 7.6 km as the crow flies.
      const t = (await tracking()).data;
      assert.equal(t.status, "out_for_delivery");
      assert.ok(t.delivery.distanceKm > 7 && t.delivery.distanceKm < 8.5, `distance ${t.delivery.distanceKm}`);
      assert.ok(t.delivery.etaMinutes >= 15 && t.delivery.etaMinutes <= 25, `about ${t.delivery.etaMinutes} min by motorbike`);
      // Moving closer updates it.
      await call(courier, "POST", "/api/courier/location", { lat: -27.3880, lng: 23.4700 });
      const nearer = (await tracking()).data.delivery;
      assert.ok(nearer.distanceKm < 0.5, `nearly there: ${nearer.distanceKm} km`);
    });

    await check("nobody else can follow the order: another customer, or even the courier, gets 'not found'", async () => {
      const lesego = await login("0710000011");
      assert.equal((await tracking(lesego)).status, 404);
      assert.equal((await tracking(courier)).status, 404);
      assert.equal((await call("", "GET", `/api/orders/${orderId}/tracking`)).status, 401);
    });

    await check("the \"on the way\" SMS links straight to the tracking page (and still fits in one SMS)", async () => {
      await processOutbox();
      const sms = await pool.query("SELECT body FROM sms_messages WHERE order_id = $1 AND body LIKE '%on the way%'", [orderId]);
      assert.equal(sms.rowCount, 1);
      assert.match(sms.rows[0].body, new RegExp(`/orders/${orderId}/track$`));
      assert.ok(sms.rows[0].body.length <= 160, `${sms.rows[0].body.length} characters`);
    });

    await check("\"I'm outside\": a chat message and an SMS to the customer, at most every 2 minutes", async () => {
      assert.equal((await tracking()).data.canCall, true, "on its way: the customer can call the courier free");
      assert.equal((await call(courier, "POST", `/api/courier/jobs/${jobId}/outside`)).status, 201);
      assert.equal((await call(courier, "POST", `/api/courier/jobs/${jobId}/outside`)).status, 429);
      await processOutbox();
      const sms = await pool.query("SELECT body FROM sms_messages WHERE order_id = $1 AND body LIKE '%outside%'", [orderId]);
      assert.equal(sms.rowCount, 1);
      assert.match(sms.rows[0].body, /Pieter, your courier, is outside/);
      assert.ok(sms.rows[0].body.length <= 160, `${sms.rows[0].body.length} characters`);
      const last = (await messages(customer)).data.messages.at(-1);
      assert.equal(last.outside, true);
    });

    await check("a customer without a pin can share where they are from the tracking page", async () => {
      assert.equal((await call(customer, "POST", `/api/orders/${noPinOrder}/location`, { lat: -26.2, lng: 28.04 })).status, 422);
      const lesego = await login("0710000011");
      assert.equal((await call(lesego, "POST", `/api/orders/${noPinOrder}/location`, HOME)).status, 404, "not someone else's order");
      assert.equal((await call(customer, "POST", `/api/orders/${noPinOrder}/location`, HOME)).status, 200);
      assert.deepEqual(await pinOf(noPinOrder), HOME);
    });

    await check("after the delivery, the courier no longer sees the customer's address or pin", async () => {
      const code = (await call(customer, "POST", `/api/orders/${orderId}/handover-code`)).data.code;
      assert.equal((await call(courier, "POST", `/api/courier/jobs/${jobId}/deliver`, { code })).status, 200);
      const done = (await call(courier, "GET", "/api/courier/my-jobs")).data.find((j: any) => j.id === jobId);
      assert.equal(done.customer, null);
    });

    await check("the chat closes when the delivery ends: the courier loses it, the customer can still read it", async () => {
      assert.equal((await messages(courier)).status, 404);
      const chat = (await messages(customer)).data;
      assert.equal(chat.canSend, false);
      assert.equal(chat.messages.length, 3);
      assert.equal((await call(customer, "POST", `/api/orders/${orderId}/messages`, { text: "Thanks!" })).status, 409);
    });

    await check("...and stops sharing: their position is deleted, and the customer no longer sees it", async () => {
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM courier_locations")).rows[0].n, 0);
      const t = (await tracking()).data;
      assert.equal(t.status, "completed");
      assert.equal(t.delivery.courierLocation, null);
      assert.equal((await call(courier, "POST", "/api/courier/location", HOME)).status, 409);
    });

    await check("a position left behind (e.g. a phone that stopped sending) is deleted by the clean-up", async () => {
      const lerato = Number((await pool.query("SELECT id FROM users WHERE phone = '+27710000006'")).rows[0].id);
      await pool.query("INSERT INTO courier_locations (courier_id, lat, lng, updated_at) VALUES ($1, -27.45, 23.43, now() - interval '2 hours')", [lerato]);
      await runRetention();
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM courier_locations")).rows[0].n, 0);
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

    await check("the pin and the chat are erased with the address 30 days after the order ends", async () => {
      await pool.query("UPDATE orders SET updated_at = now() - interval '31 days' WHERE id = $1", [orderId]);
      await runRetention();
      assert.deepEqual(await pinOf(orderId), { lat: null, lng: null });
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM delivery_messages WHERE order_id = $1", [orderId])).rows[0].n, 0);
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
