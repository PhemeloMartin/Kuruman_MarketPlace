import { pool } from "../db";
import { enqueue } from "./outbox";

// The chat between a customer and the courier delivering their order ("I'm at the blue gate",
// "Coming out now"). Like the order itself, it's private to the two of them.

export interface ChatRole {
  orderId: number;
  role: "customer" | "courier";
  canSend: boolean; // only while a courier has the order (claimed or on the way)
  otherId: number | null;
  otherName: string | null; // first name only
}

// Who is this person in the order's chat? The customer (always - they can read it afterwards too), or the
// courier, but only while they're delivering it. Anyone else: null.
export async function chatRole(orderId: number, userId: number): Promise<ChatRole | null> {
  const r = await pool.query(
    `SELECT o.consumer_id, d.courier_id, d.status AS delivery_status, cu.display_name AS customer_name, co.display_name AS courier_name
       FROM orders o
       JOIN users cu ON cu.id = o.consumer_id
       LEFT JOIN deliveries d ON d.order_id = o.id
       LEFT JOIN users co ON co.id = d.courier_id
      WHERE o.id = $1`,
    [orderId]
  );
  const o = r.rows[0];
  if (!o) return null;
  const onTheJob = o.courier_id !== null && (o.delivery_status === "claimed" || o.delivery_status === "collected");
  const first = (name: string | null) => (name ? String(name).split(" ")[0] : null);
  if (Number(o.consumer_id) === userId) {
    return { orderId, role: "customer", canSend: onTheJob, otherId: o.courier_id === null ? null : Number(o.courier_id), otherName: first(o.courier_name) };
  }
  if (onTheJob && Number(o.courier_id) === userId) {
    return { orderId, role: "courier", canSend: true, otherId: Number(o.consumer_id), otherName: first(o.customer_name) };
  }
  return null;
}

// Saves a message and, in the same transaction, queues its notification (and for "I'm outside", an SMS to
// the customer - see notificationWorker.ts). Both happen, or neither.
export async function sendDeliveryMessage(m: { orderId: number; senderId: number; recipientId: number; body: string; outside?: boolean }): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const r = await client.query(
      "INSERT INTO delivery_messages (order_id, sender_id, body, is_outside) VALUES ($1, $2, $3, $4) RETURNING id",
      [m.orderId, m.senderId, m.body, Boolean(m.outside)]
    );
    const id = Number(r.rows[0].id);
    await enqueue(client, {
      type: "delivery.message",
      aggregateId: m.orderId,
      dedupeKey: `delivery.message:${id}`,
      payload: { messageId: id, recipientId: m.recipientId, outside: Boolean(m.outside) },
    });
    await client.query("COMMIT");
    return id;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
