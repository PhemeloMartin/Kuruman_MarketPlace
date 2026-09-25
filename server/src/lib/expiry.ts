import { pool } from "../db";
import { recordStatusChange, releaseReservation } from "./stock";

// Orders the seller didn't answer in time become "expired" and their stock is released (BR-06, FR-10).
// Each order is handled in its own transaction, and the status is re-checked after locking,
// so an order the seller accepts at the very last second is left alone.
export async function expireOverdueOrders(): Promise<number> {
  const due = await pool.query(
    "SELECT id FROM orders WHERE status = 'pending_acceptance' AND accept_by < now() ORDER BY id LIMIT 100"
  );
  let expired = 0;

  for (const row of due.rows) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const r = await client.query("SELECT status, accept_by < now() AS overdue FROM orders WHERE id = $1 FOR UPDATE", [row.id]);
      if (r.rows[0]?.status !== "pending_acceptance" || !r.rows[0].overdue) {
        await client.query("ROLLBACK");
        continue;
      }
      await releaseReservation(client, Number(row.id));
      await client.query("UPDATE orders SET status = 'expired', updated_at = now() WHERE id = $1", [row.id]);
      await recordStatusChange(client, Number(row.id), "pending_acceptance", "expired", null, "Seller did not respond in time");
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

// Checks once a minute while the server is running.
export function startExpiryTimer(): void {
  const run = () =>
    expireOverdueOrders()
      .then((n) => n > 0 && console.log(`Expired ${n} unanswered order(s).`))
      .catch((err) => console.error("Expiry check failed:", err));
  run();
  setInterval(run, 60_000).unref();
}
