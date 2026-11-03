import { PoolClient } from "pg";
import { POLICY } from "./policy";
import { canonicalSiteUrl } from "./seo";

// SMS updates for the CUSTOMER about their order, next to the in-app notifications. A customer who
// closes the site - or has no data at that moment - still hears that the order was accepted, is
// ready, or can't go ahead. Only the moments that need them to do something, to keep SMS costs down:
//   - each message fits in one SMS (160 plain characters; longer ones cost double), so the shop name
//     is shortened and there are no "smart" quotes;
//   - a message goes only if the order is STILL at that step when it's sent. A stall's cash pickup
//     goes from accepted to ready at once: the customer gets one SMS ("ready"), not two.
// The demo accounts' made-up numbers never get a real SMS (lib/sms.ts only logs those).

const rand = (cents: number) => `R${(cents / 100).toFixed(2)}`;

export async function customerOrderSms(
  client: PoolClient,
  orderId: number,
  change: { from?: string | null; to: string; reason?: string | null; changedBy?: number | null }
): Promise<{ phone: string; text: string } | null> {
  const r = await client.query(
    `SELECT o.order_number, o.status, o.fulfilment, o.total_cents, o.consumer_id, u.phone, b.name AS shop
       FROM orders o JOIN users u ON u.id = o.consumer_id JOIN businesses b ON b.id = o.business_id
      WHERE o.id = $1`,
    [orderId]
  );
  const o = r.rows[0];
  if (!o?.phone) return null; // a closed account has no phone number any more
  if (o.status !== change.to) return null; // already moved on: that SMS would be out of date

  const head = `KurumanMarketPlace ${o.order_number}:`;
  const shop = String(o.shop).slice(0, 30).trim();
  const total = rand(o.total_cents);
  const orders = `${canonicalSiteUrl()}/orders`;

  switch (change.to) {
    case "awaiting_payment":
      return { phone: o.phone, text: `${head} accepted by ${shop}. Pay ${total} online within ${POLICY.paymentMinutes} min: ${orders}` };
    case "confirmed":
      return {
        phone: o.phone,
        text:
          change.from === "awaiting_payment"
            ? `${head} payment of ${total} received. We'll SMS you when it's ready.`
            : `${head} accepted by ${shop} (${total}, cash). We'll SMS you when it's ready.`,
      };
    case "ready":
      // Deliveries get their SMS when the courier sets off ("on the way").
      return o.fulfilment === "pickup"
        ? { phone: o.phone, text: `${head} ready to collect at ${shop}. Show your code from ${orders}` }
        : null;
    case "out_for_delivery":
      return {
        phone: o.phone,
        text: `${head} ${change.from === "delivery_failed" ? "we're delivering again" : "on the way to you"}. Have your code ready: ${orders}`,
      };
    case "declined": {
      const why = change.reason ? ` (${String(change.reason).slice(0, 30).trim()})` : "";
      return { phone: o.phone, text: `${head} ${shop} can't take your order${why}. You pay nothing.` };
    }
    case "expired":
      return {
        phone: o.phone,
        text:
          change.from === "awaiting_payment"
            ? `${head} not paid in time, so it's cancelled. You pay nothing.`
            : `${head} ${shop} didn't answer in time, so it's cancelled. You pay nothing.`,
      };
    case "cancelled":
      // Cancelled by the customer: they did it themselves and saw it on screen.
      return change.changedBy === Number(o.consumer_id) ? null : { phone: o.phone, text: `${head} cancelled by support. Details: ${orders}` };
    case "delivery_failed":
      return { phone: o.phone, text: `${head} the courier couldn't hand it over. Support will contact you.` };
    default:
      return null;
  }
}
