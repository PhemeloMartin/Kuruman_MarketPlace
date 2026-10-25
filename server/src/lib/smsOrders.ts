import type { PoolClient } from "pg";
import { pool } from "../db";
import { checkHandoverCode, handoverCodeMatches } from "./handover";
import { normaliseSaPhone } from "./phone";
import { POLICY } from "./policy";
import { sendSms } from "./sms";
import { consumeReservation, recordStatusChange, releaseReservation } from "./stock";

// Orders by SMS, for sellers with a basic phone (market stalls, or any shop that switches it on).
//
//   New order  -> SMS to the business phone: "... Reply 1 to accept, 2 if sold out."
//   Reply 1    -> accepted (exactly like the Accept button). A market stall's cash pickup is ready at once.
//   Reply 2    -> declined as sold out; the reserved stock is released.
//   Reply the customer's 6-digit code -> checked; if right, the order is handed over and completed.
//
// Only messages from the business's own phone count, and every change is recorded in the order's
// history like any other. Sign-in codes are never stored here.

const rand = (cents: number) => `R${(cents / 100).toFixed(2)}`;

export async function sendLoggedSms(db: PoolClient | typeof pool, phone: string, body: string, orderId: number | null = null) {
  await db.query("INSERT INTO sms_messages (phone, direction, body, order_id) VALUES ($1, 'out', $2, $3)", [phone, body, orderId]);
  await sendSms(phone, body);
}

// Called by the notification worker when a new order arrives.
export async function alertNewOrder(client: PoolClient, orderId: number): Promise<void> {
  const r = await client.query(
    `SELECT o.order_number, o.fulfilment, o.payment_method, o.total_cents, b.phone, b.sms_alerts,
            split_part(u.display_name, ' ', 1) AS first_name,
            (SELECT string_agg(i.quantity || ' x ' || i.product_name, ', ' ORDER BY i.id) FROM order_items i WHERE i.order_id = o.id) AS items
       FROM orders o JOIN businesses b ON b.id = o.business_id JOIN users u ON u.id = o.consumer_id
      WHERE o.id = $1`,
    [orderId]
  );
  const o = r.rows[0];
  if (!o || !o.sms_alerts || !o.phone) return;
  const how = o.fulfilment === "pickup" ? "to collect" : "for delivery";
  const pay = o.payment_method === "cash" ? "cash" : "paid online";
  await sendLoggedSms(
    client,
    o.phone,
    `KurumanMarketPlace ${o.order_number}: ${o.first_name} wants ${o.items} ${how}, ${rand(o.total_cents)} ${pay}. ` +
      `Reply 1 to accept or 2 if sold out. Answer within ${POLICY.sellerResponseMinutes} min.`,
    orderId
  );
}

type Reply = { text: string; orderId?: number | null };

// An SMS arrived. Returns the reply we sent back (also used by the demo phone page).
export async function handleInboundSms(fromRaw: string, textRaw: string): Promise<Reply | null> {
  const from = normaliseSaPhone(fromRaw);
  const text = textRaw.trim().toUpperCase();
  if (!from) return null;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("INSERT INTO sms_messages (phone, direction, body) VALUES ($1, 'in', $2)", [from, textRaw.slice(0, 500)]);
    const biz = await client.query(
      "SELECT id, owner_id, kind FROM businesses WHERE phone = $1 AND sms_alerts AND is_active ORDER BY id LIMIT 1",
      [from]
    );
    const b = biz.rows[0];
    let reply: Reply;
    if (!b) {
      reply = { text: "KurumanMarketPlace: this number isn't set up for SMS orders. Ask support for help." };
    } else if (text === "1" || text === "2" || /^[12]\s+KMP-\d+$/.test(text)) {
      reply = await answerOrder(client, b, text);
    } else if (/^\d{6}$/.test(text)) {
      reply = await completeByCode(client, b, text);
    } else {
      reply = { text: "KurumanMarketPlace: reply 1 to accept the newest order, 2 if sold out, or type the customer's 6-digit code when they collect." };
    }
    await sendLoggedSms(client, from, reply.text, reply.orderId ?? null);
    await client.query("COMMIT");
    return reply;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// "1" / "2" answers the oldest order still waiting (or the one named, e.g. "1 KMP-000123").
async function answerOrder(client: PoolClient, b: { id: number; owner_id: number; kind: string }, text: string): Promise<Reply> {
  const named = text.split(/\s+/)[1] ?? null;
  const r = await client.query(
    `SELECT id, order_number, status, fulfilment, payment_method, total_cents, accept_by <= now() AS overdue
       FROM orders
      WHERE business_id = $1 AND status = 'pending_acceptance' AND ($2::text IS NULL OR order_number = $2)
      ORDER BY created_at LIMIT 1
      FOR UPDATE`,
    [b.id, named]
  );
  const o = r.rows[0];
  if (!o) return { text: "KurumanMarketPlace: there's no order waiting for an answer right now." };
  const id = Number(o.id);

  if (o.overdue) {
    await releaseReservation(client, id);
    await client.query("UPDATE orders SET status = 'expired', updated_at = now() WHERE id = $1", [id]);
    await recordStatusChange(client, id, "pending_acceptance", "expired", null, "Seller did not respond in time");
    return { text: `KurumanMarketPlace ${o.order_number}: too late, the ${POLICY.sellerResponseMinutes} minutes had passed. The customer was told.`, orderId: id };
  }

  if (text.startsWith("2")) {
    await releaseReservation(client, id);
    await client.query("UPDATE orders SET status = 'declined', updated_at = now() WHERE id = $1", [id]);
    await recordStatusChange(client, id, "pending_acceptance", "declined", b.owner_id, "Sold out");
    return { text: `KurumanMarketPlace ${o.order_number}: declined as sold out. The customer was told. Thank you.`, orderId: id };
  }

  // Same rule as the Accept button: cash -> confirmed; online -> waiting for payment.
  const next = o.payment_method === "cash" ? "confirmed" : "awaiting_payment";
  await client.query(
    `UPDATE orders SET status = $2::varchar, updated_at = now(),
            payment_due_at = CASE WHEN $2::varchar = 'awaiting_payment' THEN now() + make_interval(mins => $3) END
      WHERE id = $1`,
    [id, next, POLICY.paymentMinutes]
  );
  await recordStatusChange(client, id, "pending_acceptance", next, b.owner_id, "Accepted by SMS");
  // At a market stall the goods are already on the table: a cash pickup is ready to collect at once.
  if (b.kind === "market_stall" && next === "confirmed" && o.fulfilment === "pickup") {
    await client.query("UPDATE orders SET status = 'ready', updated_at = now() WHERE id = $1", [id]);
    await recordStatusChange(client, id, "confirmed", "ready", b.owner_id, "Ready at the stall");
    return {
      text: `KurumanMarketPlace ${o.order_number}: accepted. When the customer comes, they show a 6-digit code. Send that code to this number to finish. Collect ${rand(o.total_cents)} cash.`,
      orderId: id,
    };
  }
  return { text: `KurumanMarketPlace ${o.order_number}: accepted. The customer was told.`, orderId: id };
}

// The customer's code arrived: find the ready pickup order it belongs to and complete it.
async function completeByCode(client: PoolClient, b: { id: number; owner_id: number }, code: string): Promise<Reply> {
  const r = await client.query(
    `SELECT id, order_number, payment_method, total_cents, handover_code_hash,
            handover_code_expires_at <= now() AS code_expired, handover_failed_attempts,
            (SELECT string_agg(i.quantity || ' x ' || i.product_name, ', ' ORDER BY i.id) FROM order_items i WHERE i.order_id = o.id) AS items
       FROM orders o
      WHERE business_id = $1 AND status = 'ready' AND fulfilment = 'pickup' AND handover_code_hash IS NOT NULL
      ORDER BY id
      FOR UPDATE`,
    [b.id]
  );
  const order = r.rows.find((o) => handoverCodeMatches(Number(o.id), code, o.handover_code_hash));
  if (!order) {
    return { text: "KurumanMarketPlace: that code doesn't match an order waiting at your stall. Check the number with the customer." };
  }
  // The full check again (expiry, too many tries) - the same as the seller's screen.
  const check = await checkHandoverCode(client, { ...order, id: Number(order.id) }, code);
  if (!check.ok) return { text: `KurumanMarketPlace: ${check.body.error}`, orderId: Number(order.id) };

  const id = Number(order.id);
  await consumeReservation(client, id);
  if (order.payment_method === "cash") {
    await client.query(
      `INSERT INTO cash_receipts (order_id, collected_by, collected_cents, remitted_cents, remitted_at, status, acknowledged_by)
       VALUES ($1, $2, $3, $3, now(), 'remitted', $2)`,
      [id, b.owner_id, order.total_cents]
    );
  }
  await client.query(
    "UPDATE orders SET status = 'completed', handover_code_hash = NULL, handover_code_expires_at = NULL, updated_at = now() WHERE id = $1",
    [id]
  );
  await recordStatusChange(client, id, "ready", "completed", b.owner_id, "Collected at the stall (code sent by SMS)");
  const cash = order.payment_method === "cash" ? ` Collect ${rand(order.total_cents)} cash.` : " It is already paid.";
  return { text: `KurumanMarketPlace ${order.order_number}: code correct. Hand over ${order.items}.${cash}`, orderId: id };
}
