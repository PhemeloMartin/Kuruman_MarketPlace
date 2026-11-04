import type { PoolClient } from "pg";
import { pool } from "../db";
import { checkHandoverCode, handoverCodeMatches } from "./handover";
import { normaliseSaPhone } from "./phone";
import { POLICY } from "./policy";
import { sendSms } from "./sms";
import { smsText } from "./smsText";
import { consumeReservation, recordStatusChange, releaseReservation } from "./stock";

// Orders by SMS, for sellers with a basic phone (market stalls, or any shop that switches it on).
//
//   New order  -> SMS to the business phone: "... Reply 1 to accept, 2 if sold out."
//   Reply 1    -> accepted (exactly like the Accept button). A market stall's cash pickup is ready at once.
//   Reply 2    -> declined as sold out; the reserved stock is released.
//   Reply the customer's 6-digit code -> checked; if right, the order is handed over and completed.
//
// Only messages from the business's own phone count, and every change is recorded in the order's
// history like any other. Sign-in codes are never stored here. Our SMS go in the language of the stall
// owner's account (the words are in smsText.ts).

const rand = (cents: number) => `R${(cents / 100).toFixed(2)}`;

export async function sendLoggedSms(db: PoolClient | typeof pool, phone: string, body: string, orderId: number | null = null) {
  await db.query("INSERT INTO sms_messages (phone, direction, body, order_id) VALUES ($1, 'out', $2, $3)", [phone, body, orderId]);
  await sendSms(phone, body, { repliable: true });
}

// Called by the notification worker when a new order arrives.
export async function alertNewOrder(client: PoolClient, orderId: number): Promise<void> {
  const r = await client.query(
    `SELECT o.order_number, o.fulfilment, o.payment_method, o.total_cents, b.phone, b.sms_alerts,
            split_part(u.display_name, ' ', 1) AS first_name, ow.preferred_language,
            (SELECT string_agg(i.quantity || ' x ' || i.product_name, ', ' ORDER BY i.id) FROM order_items i WHERE i.order_id = o.id) AS items
       FROM orders o JOIN businesses b ON b.id = o.business_id JOIN users u ON u.id = o.consumer_id
       JOIN users ow ON ow.id = b.owner_id
      WHERE o.id = $1`,
    [orderId]
  );
  const o = r.rows[0];
  if (!o || !o.sms_alerts || !o.phone) return;
  const text = smsText("stall.new_order", o.preferred_language, {
    order: o.order_number,
    customer: o.first_name,
    items: o.items,
    pickup: o.fulfilment === "pickup",
    cash: o.payment_method === "cash",
    total: rand(o.total_cents),
    minutes: POLICY.sellerResponseMinutes,
  });
  await sendLoggedSms(client, o.phone, text, orderId);
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
      `SELECT b.id, b.owner_id, b.kind, u.preferred_language AS lang
         FROM businesses b JOIN users u ON u.id = b.owner_id
        WHERE b.phone = $1 AND b.sms_alerts AND b.is_active ORDER BY b.id LIMIT 1`,
      [from]
    );
    const b = biz.rows[0];
    let reply: Reply;
    if (!b) {
      // A number we don't know: we don't know its language either.
      reply = { text: "KurumanMarketPlace: this number isn't set up for SMS orders. Ask support for help." };
    } else if (text === "1" || text === "2" || /^[12]\s+KMP-\d+$/.test(text)) {
      reply = await answerOrder(client, b, text);
    } else if (/^\d{6}$/.test(text)) {
      reply = await completeByCode(client, b, text);
    } else {
      reply = { text: smsText("stall.help", b.lang) };
    }
    // Our answer is recorded with the change, then sent once it's saved: if the SMS gateway is down,
    // the stall holder's "1" still counts (they also see the order on the site).
    await client.query("INSERT INTO sms_messages (phone, direction, body, order_id) VALUES ($1, 'out', $2, $3)", [
      from,
      reply.text,
      reply.orderId ?? null,
    ]);
    await client.query("COMMIT");
    await sendSms(from, reply.text, { repliable: true }).catch((err) => console.error("Reply SMS not sent:", err.message));
    return reply;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// "1" / "2" answers the oldest order still waiting (or the one named, e.g. "1 KMP-000123").
async function answerOrder(client: PoolClient, b: { id: number; owner_id: number; kind: string; lang: string }, text: string): Promise<Reply> {
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
  if (!o) return { text: smsText("stall.nothing_waiting", b.lang) };
  const id = Number(o.id);
  const say = (key: Parameters<typeof smsText>[0]) =>
    ({ text: smsText(key, b.lang, { order: o.order_number, minutes: POLICY.sellerResponseMinutes, total: rand(o.total_cents) }), orderId: id });

  if (o.overdue) {
    await releaseReservation(client, id);
    await client.query("UPDATE orders SET status = 'expired', updated_at = now() WHERE id = $1", [id]);
    await recordStatusChange(client, id, "pending_acceptance", "expired", null, "Seller did not respond in time");
    return say("stall.too_late");
  }

  if (text.startsWith("2")) {
    await releaseReservation(client, id);
    await client.query("UPDATE orders SET status = 'declined', updated_at = now() WHERE id = $1", [id]);
    await recordStatusChange(client, id, "pending_acceptance", "declined", b.owner_id, "Sold out");
    return say("stall.sold_out");
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
    return say("stall.accepted_ready_cash");
  }
  return next === "awaiting_payment" ? say("stall.accepted_online") : say("stall.accepted");
}

// The customer paid online for an order at a market stall. A stall holder with a basic phone can't tap
// "Ready", and the goods are already on the table, so the order is ready to collect at once - and the
// stall is told by SMS. Runs inside the payment's transaction; returns the SMS to send after COMMIT.
export async function paidAtStall(client: PoolClient, orderId: number): Promise<{ phone: string; text: string } | null> {
  const r = await client.query(
    `SELECT o.order_number, o.total_cents, b.owner_id, b.phone, b.sms_alerts, u.preferred_language
       FROM orders o JOIN businesses b ON b.id = o.business_id JOIN users u ON u.id = b.owner_id
      WHERE o.id = $1 AND o.status = 'confirmed' AND o.fulfilment = 'pickup' AND b.kind = 'market_stall'`,
    [orderId]
  );
  const o = r.rows[0];
  if (!o) return null;
  await client.query("UPDATE orders SET status = 'ready', updated_at = now() WHERE id = $1", [orderId]);
  await recordStatusChange(client, orderId, "confirmed", "ready", o.owner_id, "Ready at the stall");
  if (!o.sms_alerts || !o.phone) return null;
  const text = smsText("stall.paid_ready", o.preferred_language, { order: o.order_number, total: rand(o.total_cents) });
  await client.query("INSERT INTO sms_messages (phone, direction, body, order_id) VALUES ($1, 'out', $2, $3)", [o.phone, text, orderId]);
  return { phone: o.phone, text };
}

// The customer's code arrived: find the ready pickup order it belongs to and complete it.
async function completeByCode(client: PoolClient, b: { id: number; owner_id: number; lang: string }, code: string): Promise<Reply> {
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
    return { text: smsText("stall.code_no_match", b.lang) };
  }
  // The full check again (expiry, too many tries) - the same as the seller's screen. (Its rare error
  // messages are still in English only.)
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
  return {
    text: smsText("stall.code_correct", b.lang, {
      order: order.order_number,
      items: order.items,
      cash: order.payment_method === "cash",
      total: rand(order.total_cents),
    }),
    orderId: id,
  };
}
