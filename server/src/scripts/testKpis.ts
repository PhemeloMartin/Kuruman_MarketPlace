import assert from "assert/strict";
import { PoolClient } from "pg";
import { pool } from "../db";
import { computeKpis } from "../lib/kpi";

// Test TC-18: the KPI fixture from spec section 7.5, Table 33.
// Everything is created inside a transaction and rolled back at the end,
// so this never changes the real (demo) data.
//
//   A  COMPLETED / cash     R50 + R25 delivery   R75 collected, R0 remitted
//   B  COMPLETED / online   R200                 (digital money metrics come with Payfast)
//   C  COMPLETED / online   R250 + R25 delivery
//   D, E, F  PENDING        R100 each
//   G  DECLINED             R80
//
// Expected: 3 pending; R500 gross delivered product sales; 75% acceptance (3 of 4 decided);
// R166.67 average completed product value; R75 unreconciled cash.

let seq = 0;

async function addOrder(
  c: PoolClient,
  ids: { customer: number; business: number; product: number },
  path: string[], // status path, e.g. ["pending_acceptance", "confirmed", "ready", "completed"]
  method: "cash" | "online",
  subtotal: number,
  fee: number
): Promise<number> {
  seq++;
  const r = await c.query(
    `INSERT INTO orders (consumer_id, business_id, status, fulfilment, payment_method, subtotal_cents,
                         delivery_fee_cents, total_cents, delivery_address, accept_by, idempotency_key, request_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now() + interval '30 minutes', $10, repeat('0', 64))
     RETURNING id`,
    [
      ids.customer, ids.business, path[path.length - 1], fee ? "delivery" : "pickup", method,
      subtotal, fee, subtotal + fee, fee ? "Fixture address" : null, `fixture-${seq}`,
    ]
  );
  const orderId = r.rows[0].id;
  await c.query(
    `INSERT INTO order_items (order_id, product_id, product_name, unit_label, unit_price_cents, quantity, line_total_cents)
     VALUES ($1, $2, 'Fixture item', '1 item', $3, 1, $3)`,
    [orderId, ids.product, subtotal]
  );
  let from: string | null = null;
  for (const to of path) {
    await c.query("INSERT INTO order_status_history (order_id, from_status, to_status) VALUES ($1, $2, $3)", [orderId, from, to]);
    from = to;
  }
  return Number(orderId);
}

async function main() {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const seller = await c.query(
      `INSERT INTO users (phone, display_name, password_hash, role)
       VALUES ('+27719999901', 'Fixture seller', 'x', 'entrepreneur') RETURNING id`
    );
    const customer = await c.query(
      `INSERT INTO users (phone, display_name, password_hash, role)
       VALUES ('+27719999902', 'Fixture customer', 'x', 'consumer') RETURNING id`
    );
    const business = await c.query(
      `INSERT INTO businesses (owner_id, name, area, pickup_address, phone)
       VALUES ($1, 'Fixture business', 'Test', 'Test', '+27719999901') RETURNING id`,
      [seller.rows[0].id]
    );
    const category = await c.query("INSERT INTO categories (slug, name) VALUES ('fixture', 'Fixture') RETURNING id");
    const product = await c.query(
      `INSERT INTO products (business_id, category_id, name, unit_label, price_cents, stock_qty)
       VALUES ($1, $2, 'Fixture item', '1 item', 100, 100) RETURNING id`,
      [business.rows[0].id, category.rows[0].id]
    );
    const ids = {
      customer: Number(customer.rows[0].id),
      business: Number(business.rows[0].id),
      product: Number(product.rows[0].id),
    };

    const cashDone = ["pending_acceptance", "confirmed", "ready", "out_for_delivery", "completed"];
    const onlineDone = ["pending_acceptance", "awaiting_payment", "confirmed", "ready", "completed"];
    const a = await addOrder(c, ids, cashDone, "cash", 5000, 2500);
    await addOrder(c, ids, onlineDone, "online", 20000, 0);
    await addOrder(c, ids, [...onlineDone.slice(0, 4), "out_for_delivery", "completed"], "online", 25000, 2500);
    for (let i = 0; i < 3; i++) await addOrder(c, ids, ["pending_acceptance"], "cash", 10000, 0);
    await addOrder(c, ids, ["pending_acceptance", "declined"], "cash", 8000, 0);

    // Order A: a courier collected R75 cash and has not yet handed it to the business.
    await c.query(
      "INSERT INTO cash_receipts (order_id, collected_by, collected_cents, remitted_cents) VALUES ($1, $2, 7500, 0)",
      [a, seller.rows[0].id]
    );

    const k = await computeKpis(c, ids.business, new Date(Date.now() - 86_400_000), new Date(Date.now() + 60_000));
    console.log(k);

    assert.equal(k.pendingOrders, 3, "pending orders");
    assert.equal(k.grossDeliveredCents, 50000, "gross delivered product sales = R500");
    assert.equal(k.completedOrders, 3, "completed orders");
    assert.equal(k.acceptanceRate, 0.75, "acceptance rate = 75%");
    assert.equal(Math.round(k.averageCompletedCents!), 16667, "average completed product value = R166.67");
    assert.equal(k.unreconciledCashCents, 7500, "unreconciled cash = R75");
    assert.equal(k.lowStockProducts, 0, "low stock");
    console.log("\nTC-18 KPI fixture: PASS (all values match spec Table 33)");
    console.log("Not yet covered: net delivered value and digital collections (need refunds/Payfast).");
  } finally {
    await c.query("ROLLBACK");
    c.release();
  }
}

main()
  .catch((err) => {
    console.error("\nTC-18 KPI fixture: FAIL\n", err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
