import { PoolClient } from "pg";
import { POLICY } from "./policy";
import { canonicalSiteUrl } from "./seo";
import { smsText } from "./smsText";

// SMS updates for the CUSTOMER about their order, next to the in-app notifications. A customer who
// closes the site - or has no data at that moment - still hears that the order was accepted, is
// ready, or can't go ahead. Only the moments that need them to do something, to keep SMS costs down:
//   - each message fits in one SMS (160 plain characters; longer ones cost double), so the shop name
//     is shortened and there are no "smart" quotes;
//   - a message goes only if the order is STILL at that step when it's sent. A stall's cash pickup
//     goes from accepted to ready at once: the customer gets one SMS ("ready"), not two;
//   - in the customer's language (English, Setswana or Afrikaans): the words are in smsText.ts.
// The demo accounts' made-up numbers never get a real SMS (lib/sms.ts only logs those).

const rand = (cents: number) => `R${(cents / 100).toFixed(2)}`;

export async function customerOrderSms(
  client: PoolClient,
  orderId: number,
  change: { from?: string | null; to: string; reason?: string | null; changedBy?: number | null }
): Promise<{ phone: string; text: string } | null> {
  const r = await client.query(
    `SELECT o.order_number, o.status, o.fulfilment, o.total_cents, o.consumer_id, u.phone, u.preferred_language, b.name AS shop
       FROM orders o JOIN users u ON u.id = o.consumer_id JOIN businesses b ON b.id = o.business_id
      WHERE o.id = $1`,
    [orderId]
  );
  const o = r.rows[0];
  if (!o?.phone) return null; // a closed account has no phone number any more
  if (o.status !== change.to) return null; // already moved on: that SMS would be out of date

  const shop = String(o.shop).slice(0, 30).trim();
  const total = rand(o.total_cents);
  const orders = `${canonicalSiteUrl()}/orders`;
  const sms = (key: Parameters<typeof smsText>[0], args: Record<string, string | number | boolean> = {}) => ({
    phone: o.phone,
    text: smsText(key, o.preferred_language, { order: o.order_number, shop, total, ...args }),
  });

  switch (change.to) {
    case "awaiting_payment":
      return sms("order.pay_now", { minutes: POLICY.paymentMinutes, link: orders });
    case "confirmed":
      return change.from === "awaiting_payment" ? sms("order.paid") : sms("order.accepted_cash");
    case "ready":
      // Deliveries get their SMS when the courier sets off ("on the way").
      return o.fulfilment === "pickup" ? sms("order.ready_pickup", { link: orders }) : null;
    case "out_for_delivery":
      return sms("order.on_the_way", { retry: change.from === "delivery_failed", link: `${orders}/${orderId}/track` });
    case "declined":
      return sms("order.declined", { why: change.reason ? ` (${String(change.reason).slice(0, 30).trim()})` : "" });
    case "expired":
      return change.from === "awaiting_payment" ? sms("order.expired_unpaid") : sms("order.expired_no_reply");
    case "cancelled":
      // Cancelled by the customer: they did it themselves and saw it on screen.
      return change.changedBy === Number(o.consumer_id) ? null : sms("order.cancelled_by_support", { link: orders });
    case "delivery_failed":
      return sms("order.delivery_failed");
    default:
      return null;
  }
}

// The courier pressed "I'm outside": the customer may have closed the site while waiting, so they get an SMS
// too. Only while the order is still on its way.
export async function courierOutsideSms(client: PoolClient, orderId: number): Promise<{ phone: string; text: string } | null> {
  const r = await client.query(
    `SELECT o.order_number, o.status, u.phone, u.preferred_language, co.display_name AS courier
       FROM orders o JOIN users u ON u.id = o.consumer_id
       JOIN deliveries d ON d.order_id = o.id JOIN users co ON co.id = d.courier_id
      WHERE o.id = $1`,
    [orderId]
  );
  const o = r.rows[0];
  if (!o?.phone || o.status !== "out_for_delivery") return null;
  return {
    phone: o.phone,
    text: smsText("courier.outside", o.preferred_language, {
      order: o.order_number,
      name: String(o.courier).split(" ")[0].slice(0, 12),
      link: `${canonicalSiteUrl()}/orders/${orderId}/track`,
    }),
  };
}

// Support answered someone's help ticket: a short SMS with the link, so they hear it even when the site is
// closed (the answer itself stays on the site). Fits in one SMS: the subject is shortened.
export async function ticketAnsweredSms(
  client: PoolClient,
  p: { userId: number; ticketId: number; subject: string }
): Promise<{ phone: string; text: string } | null> {
  const u = await client.query("SELECT phone, preferred_language FROM users WHERE id = $1", [p.userId]);
  if (!u.rows[0]?.phone) return null;
  return {
    phone: u.rows[0].phone,
    text: smsText("ticket.answered", u.rows[0].preferred_language, {
      ticketId: p.ticketId,
      subject: String(p.subject).slice(0, 35).trim(),
      link: `${canonicalSiteUrl()}/help/${p.ticketId}`,
    }),
  };
}
