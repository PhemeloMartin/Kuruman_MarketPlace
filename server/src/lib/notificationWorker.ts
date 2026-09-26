import { PoolClient } from "pg";
import { pool } from "../db";

// The notification worker (spec FR-17, TC-17). It runs separately from the requests that
// change orders: every few seconds it takes pending outbox events and creates the in-app
// notifications they call for.
//
// Why separate? If notifying fails (today: a bug or a database hiccup; later: an SMS or push
// provider being down), the order is already committed and nobody's purchase is lost. The event
// just waits and is retried - and UNIQUE (user_id, event_key) makes a retry harmless.

const MAX_ATTEMPTS = 5;
const BATCH = 20;

interface Note {
  userId: number;
  template: string;
  args?: Record<string, unknown>;
}

// Who hears about an order status change, and with which message. The worker re-reads the
// order now, rather than trusting old data in the event.
async function orderStatusNotes(client: PoolClient, orderId: number, p: Record<string, any>): Promise<Note[]> {
  const r = await client.query(
    `SELECT o.order_number, o.consumer_id, o.fulfilment, b.owner_id
       FROM orders o JOIN businesses b ON b.id = o.business_id WHERE o.id = $1`,
    [orderId]
  );
  const o = r.rows[0];
  if (!o) return [];
  const customer = Number(o.consumer_id);
  const seller = Number(o.owner_id);
  const args = { orderNumber: o.order_number };

  switch (p.to) {
    case "pending_acceptance":
      return [{ userId: seller, template: "seller.new_order", args }];
    case "awaiting_payment":
      return [{ userId: customer, template: "customer.accepted_pay_now", args }];
    case "confirmed":
      return p.from === "awaiting_payment"
        ? [
            { userId: customer, template: "customer.payment_received", args },
            { userId: seller, template: "seller.order_paid", args },
          ]
        : [{ userId: customer, template: "customer.accepted", args }];
    case "declined":
      return [{ userId: customer, template: "customer.declined", args: { ...args, reason: p.reason } }];
    case "expired":
      return [{ userId: customer, template: p.from === "awaiting_payment" ? "customer.expired_unpaid" : "customer.expired_no_reply", args }];
    case "cancelled":
      // Cancelled by the customer: tell the seller. By support: tell both.
      return p.changedBy === customer
        ? [{ userId: seller, template: "seller.cancelled_by_customer", args }]
        : [
            { userId: customer, template: "customer.cancelled_by_support", args },
            { userId: seller, template: "seller.cancelled_by_support", args },
          ];
    case "ready":
      return [{ userId: customer, template: o.fulfilment === "pickup" ? "customer.ready_pickup" : "customer.ready_delivery", args }];
    case "out_for_delivery":
      return [{ userId: customer, template: p.from === "delivery_failed" ? "customer.delivery_retry" : "customer.on_the_way", args }];
    case "delivery_failed":
      return [
        { userId: customer, template: "customer.delivery_failed", args },
        { userId: seller, template: "seller.delivery_failed", args },
      ];
    case "completed":
      return [{ userId: customer, template: "customer.completed", args }];
    default:
      return [];
  }
}

async function notesFor(client: PoolClient, e: { event_type: string; aggregate_id: string; payload: any }): Promise<Note[]> {
  const id = Number(e.aggregate_id);
  switch (e.event_type) {
    case "order.status_changed":
      return orderStatusNotes(client, id, e.payload);
    case "refund.succeeded": {
      const r = await client.query("SELECT order_number, consumer_id FROM orders WHERE id = $1", [id]);
      return [{ userId: Number(r.rows[0].consumer_id), template: "customer.refunded", args: { orderNumber: r.rows[0].order_number, amountCents: e.payload.amountCents } }];
    }
    case "application.decided":
      return [{ userId: e.payload.userId, template: e.payload.approved ? "applicant.approved" : "applicant.rejected", args: { kind: e.payload.kind, reason: e.payload.reason } }];
    case "privacy.held":
      return [{ userId: e.payload.userId, template: "privacy.held", args: {} }];
    default:
      throw new Error(`Unknown event type ${e.event_type}`);
  }
}

// One pass over the due events. `failWith` lets the TC-17 test pretend delivery is broken.
export async function processOutbox(options: { failWith?: string } = {}): Promise<{ sent: number; failed: number }> {
  const client = await pool.connect();
  let sent = 0;
  let failed = 0;
  try {
    await client.query("BEGIN");
    // SKIP LOCKED: if two workers ever run at once (two servers), they take different events.
    const due = await client.query(
      `SELECT id, event_type, aggregate_id, dedupe_key, payload, attempts FROM outbox_events
        WHERE status = 'pending' AND available_at <= now()
        ORDER BY id LIMIT $1 FOR UPDATE SKIP LOCKED`,
      [BATCH]
    );
    for (const e of due.rows) {
      // A savepoint per event: one broken event is retried later without undoing the others.
      await client.query("SAVEPOINT one_event");
      try {
        if (options.failWith) throw new Error(options.failWith);
        for (const n of await notesFor(client, e)) {
          await client.query(
            `INSERT INTO notifications (user_id, order_id, event_key, template_key, arguments)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (user_id, event_key) DO NOTHING`,
            [n.userId, e.event_type.startsWith("application") || e.event_type.startsWith("privacy") ? null : e.aggregate_id, e.dedupe_key, n.template, n.args ?? {}]
          );
        }
        await client.query("UPDATE outbox_events SET status = 'sent', sent_at = now(), last_error = NULL WHERE id = $1", [e.id]);
        await client.query("RELEASE SAVEPOINT one_event");
        sent++;
      } catch (err) {
        await client.query("ROLLBACK TO SAVEPOINT one_event");
        const attempts = e.attempts + 1;
        // Wait longer after each failure (10 s, 20 s, 40 s, 80 s), then give up and show support.
        await client.query(
          `UPDATE outbox_events
              SET attempts = $2::int, last_error = $3,
                  status = CASE WHEN $2::int >= $4::int THEN 'failed' ELSE 'pending' END,
                  available_at = now() + make_interval(secs => 5 * power(2, $2::int))
            WHERE id = $1`,
          [e.id, attempts, String((err as Error).message).slice(0, 200), MAX_ATTEMPTS]
        );
        failed++;
      }
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
  return { sent, failed };
}

// Every 5 seconds while the server runs. NOTIFICATIONS_WORKER=off stops it (used by TC-17).
export function startNotificationWorker(): void {
  if (process.env.NOTIFICATIONS_WORKER === "off") {
    console.log("Notification worker is OFF (NOTIFICATIONS_WORKER=off).");
    return;
  }
  const run = () =>
    processOutbox()
      .then((r) => r.failed > 0 && console.warn(`Notifications: ${r.failed} event(s) failed, will retry.`))
      .catch((err) => console.error("Notification worker error:", err));
  setInterval(run, 5_000).unref();
}
