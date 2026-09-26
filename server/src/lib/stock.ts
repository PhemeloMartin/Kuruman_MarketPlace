import { PoolClient } from "pg";
import { enqueue } from "./outbox";

// Gives back the units an order was holding (on decline, cancel or expiry).
// Must be called inside a transaction that has already locked the order row.
// Products are locked in id order - the same order used when reserving - so two
// transactions can never wait on each other in a circle (a deadlock).
export async function releaseReservation(client: PoolClient, orderId: number): Promise<void> {
  const items = await client.query(
    "SELECT product_id, quantity FROM order_items WHERE order_id = $1 ORDER BY product_id",
    [orderId]
  );
  for (const item of items.rows) {
    await client.query("SELECT id FROM products WHERE id = $1 FOR UPDATE", [item.product_id]);
    await client.query("UPDATE products SET reserved_qty = reserved_qty - $2, updated_at = now() WHERE id = $1", [
      item.product_id,
      item.quantity,
    ]);
  }
}

// Goods physically handed over: the held units leave the shelf for good (spec BR-04, FR-06).
// Both counters drop together, so "available" (stock - reserved) doesn't change.
export async function consumeReservation(client: PoolClient, orderId: number): Promise<void> {
  const items = await client.query(
    "SELECT product_id, quantity FROM order_items WHERE order_id = $1 ORDER BY product_id",
    [orderId]
  );
  for (const item of items.rows) {
    await client.query("SELECT id FROM products WHERE id = $1 FOR UPDATE", [item.product_id]);
    await client.query(
      `UPDATE products SET stock_qty = stock_qty - $2, reserved_qty = reserved_qty - $2, updated_at = now()
        WHERE id = $1`,
      [item.product_id, item.quantity]
    );
  }
}

// Every status change is written to order_status_history (business rule 8) - and, in the same
// transaction, queued in the outbox so the right people are notified (spec FR-17). Because
// every status change in the app goes through this one function, none can be missed.
export async function recordStatusChange(
  client: PoolClient,
  orderId: number,
  from: string | null,
  to: string,
  changedBy: number | null,
  reason: string | null = null
): Promise<void> {
  const h = await client.query(
    `INSERT INTO order_status_history (order_id, from_status, to_status, changed_by, reason)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [orderId, from, to, changedBy, reason]
  );
  await enqueue(client, {
    type: "order.status_changed",
    aggregateId: orderId,
    dedupeKey: `order-status:${h.rows[0].id}`, // one history row = one event
    payload: { from, to, changedBy, reason },
  });
}

// Goods came back after a cancelled delivery AND the seller checked they can be sold again
// (spec 5.6: "physical returns are inspected before any restock"). Only then do the units go
// back on the shelf. The reservation was already consumed at collection, so only stock_qty rises.
export async function returnToStock(client: PoolClient, orderId: number): Promise<void> {
  const items = await client.query(
    "SELECT product_id, quantity FROM order_items WHERE order_id = $1 ORDER BY product_id",
    [orderId]
  );
  for (const item of items.rows) {
    await client.query("SELECT id FROM products WHERE id = $1 FOR UPDATE", [item.product_id]);
    await client.query("UPDATE products SET stock_qty = stock_qty + $2, updated_at = now() WHERE id = $1", [
      item.product_id,
      item.quantity,
    ]);
  }
}
