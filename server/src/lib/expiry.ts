import { pool } from "../db";
import { openOrderCase } from "./cases";
import { POLICY } from "./policy";
import { recordStatusChange, releaseReservation } from "./stock";

// Orders the seller didn't answer in time become "expired" and their stock is released (BR-06, FR-10).
// Each order is handled in its own transaction, and the status is re-checked after locking,
// so an order the seller accepts at the very last second is left alone.
export async function expireOverdueOrders(): Promise<number> {
  const due = await pool.query(
    `SELECT id FROM orders
      WHERE (status = 'pending_acceptance' AND accept_by < now())
         OR (status = 'awaiting_payment' AND payment_due_at < now())
      ORDER BY id LIMIT 100`
  );
  let expired = 0;

  for (const row of due.rows) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // Re-check after locking: a seller decision or a verified payment may have just won the race.
      const r = await client.query(
        `SELECT status,
                (status = 'pending_acceptance' AND accept_by < now())
                  OR (status = 'awaiting_payment' AND payment_due_at < now()) AS overdue
           FROM orders WHERE id = $1 FOR UPDATE`,
        [row.id]
      );
      const status = r.rows[0]?.status;
      if (!r.rows[0]?.overdue) {
        await client.query("ROLLBACK");
        continue;
      }
      await releaseReservation(client, Number(row.id));
      await client.query("UPDATE orders SET status = 'expired', payment_due_at = NULL, updated_at = now() WHERE id = $1", [row.id]);
      await recordStatusChange(
        client,
        Number(row.id),
        status,
        "expired",
        null,
        status === "pending_acceptance" ? "Seller did not respond in time" : "Online payment not received in time"
      );
      await client.query("COMMIT");
      expired++;
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("Could not expire order", row.id, err);
    } finally {
      client.release();
    }
  }
  return expired;
}

// BR-10: a delivery job nobody has claimed within 30 minutes goes to support. We never promise
// the customer a courier; support offers a new time or a cancellation. Each order is flagged
// once only (NOT EXISTS), even after support closes the case.
export async function flagUnclaimedDeliveries(): Promise<number> {
  const due = await pool.query(
    `SELECT o.id, o.consumer_id
       FROM deliveries d JOIN orders o ON o.id = d.order_id
      WHERE d.status = 'open' AND o.status = 'ready'
        AND d.created_at < now() - make_interval(mins => $1)
        AND NOT EXISTS (SELECT 1 FROM support_cases c
                         WHERE c.order_id = o.id AND c.case_type = 'fulfilment' AND c.details->>'why' = 'no_courier')
      ORDER BY o.id LIMIT 100`,
    [POLICY.courierClaimMinutes]
  );
  for (const row of due.rows) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await openOrderCase(client, {
        type: "fulfilment",
        orderId: Number(row.id),
        requesterId: Number(row.consumer_id),
        details: { why: "no_courier" },
        actorId: null,
      });
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("Could not flag unclaimed delivery", row.id, err);
    } finally {
      client.release();
    }
  }
  return due.rowCount ?? 0;
}

// Checks once a minute while the server is running.
export function startExpiryTimer(): void {
  const run = () =>
    expireOverdueOrders()
      .then((n) => n > 0 && console.log(`Expired ${n} unanswered order(s).`))
      .then(() => flagUnclaimedDeliveries())
      .then((n) => n > 0 && console.log(`Sent ${n} unclaimed delivery job(s) to support.`))
      .catch((err) => console.error("Expiry check failed:", err));
  run();
  setInterval(run, 60_000).unref();
}
