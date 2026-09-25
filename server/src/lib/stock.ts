import { PoolClient } from "pg";

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

// Every status change is written to order_status_history (business rule 8).
export async function recordStatusChange(
  client: PoolClient,
  orderId: number,
  from: string | null,
  to: string,
  changedBy: number | null,
  reason: string | null = null
): Promise<void> {
  await client.query(
    `INSERT INTO order_status_history (order_id, from_status, to_status, changed_by, reason)
     VALUES ($1, $2, $3, $4, $5)`,
    [orderId, from, to, changedBy, reason]
  );
}
