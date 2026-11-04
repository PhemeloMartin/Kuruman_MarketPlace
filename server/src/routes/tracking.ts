import { Router } from "express";
import { pool } from "../db";
import { requireAuth } from "../auth/session";
import { POLICY } from "../lib/policy";
import { distanceKm, etaMinutes, inServiceArea, parsePoint } from "../lib/geo";
import { chatRole, sendDeliveryMessage } from "../lib/deliveryChat";

// Following a delivery, like Uber Eats: where the order is, where the courier is, and roughly how far
// away. Only the customer who placed the order sees this, and the courier's position only while they
// are delivering it (courier.ts keeps just their latest position, and deletes it when they're done).
// (Mounted at /api/orders next to orders.ts, so each route checks sign-in itself rather than the whole router.)
export const trackingRouter = Router();

const ACTIVE = ["pending_acceptance", "awaiting_payment", "confirmed", "ready", "out_for_delivery"];

// GET /api/orders/:id/tracking - the tracking page (refreshed every few seconds while it's open).
trackingRouter.get("/:id/tracking", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(404).json({ error: "Order not found." });
  const r = await pool.query(
    `SELECT o.id, o.order_number, o.status, o.fulfilment, o.payment_method, o.total_cents,
            (SELECT h.reason FROM order_status_history h WHERE h.order_id = o.id ORDER BY h.id DESC LIMIT 1) AS status_reason,
            o.delivery_address, o.delivery_lat, o.delivery_lng,
            b.name AS shop_name, b.area AS shop_area,
            d.status AS delivery_status, co.display_name AS courier_name, cp.vehicle_type,
            l.lat AS courier_lat, l.lng AS courier_lng, l.accuracy_m,
            extract(epoch FROM now() - l.updated_at)::int AS seconds_ago,
            (SELECT count(*)::int FROM delivery_messages m
              WHERE m.order_id = o.id AND m.sender_id <> o.consumer_id AND m.read_at IS NULL) AS unread_messages
       FROM orders o
       JOIN businesses b ON b.id = o.business_id
       LEFT JOIN deliveries d ON d.order_id = o.id
       LEFT JOIN users co ON co.id = d.courier_id
       LEFT JOIN courier_profiles cp ON cp.user_id = d.courier_id
       -- Only while this order is being delivered, and only a recent position.
       LEFT JOIN courier_locations l ON l.courier_id = d.courier_id AND d.status IN ('claimed', 'collected')
                                    AND l.updated_at > now() - interval '30 minutes'
      WHERE o.id = $1 AND o.consumer_id = $2`,
    [id, req.user!.id]
  );
  const o = r.rows[0];
  // Someone else's order: "not found", so we don't reveal that it exists.
  if (!o) return res.status(404).json({ error: "Order not found." });

  const home = o.delivery_lat === null ? null : { lat: o.delivery_lat, lng: o.delivery_lng };
  const courierAt = o.courier_lat === null ? null : { lat: o.courier_lat, lng: o.courier_lng };
  // How far, once the courier has the order and is heading to the customer.
  const km = o.delivery_status === "collected" && home && courierAt ? distanceKm(courierAt, home) : null;

  res.json({
    orderId: Number(o.id),
    orderNumber: o.order_number,
    status: o.status,
    statusReason: o.status_reason,
    fulfilment: o.fulfilment,
    paymentMethod: o.payment_method,
    totalCents: o.total_cents,
    shop: { name: o.shop_name, area: o.shop_area },
    destination: o.fulfilment === "pickup" ? null : { address: o.delivery_address, location: home },
    // Can the customer still add or move their pin? Until the order is delivered.
    canSetPin: o.fulfilment !== "pickup" && ACTIVE.includes(o.status),
    delivery: o.delivery_status
      ? {
          status: o.delivery_status,
          // First name only.
          courier: o.courier_name ? { name: String(o.courier_name).split(" ")[0], vehicleType: o.vehicle_type } : null,
          courierLocation: courierAt ? { ...courierAt, accuracyM: o.accuracy_m, secondsAgo: o.seconds_ago } : null,
          distanceKm: km === null ? null : Math.round(km * 10) / 10,
          etaMinutes: km === null ? null : etaMinutes(km, o.vehicle_type),
        }
      : null,
    mapCentre: home ?? courierAt ?? POLICY.serviceCentre,
    // Messages from the courier the customer hasn't seen yet, and what they can do from this page.
    unreadMessages: o.unread_messages,
    canMessage: o.courier_name !== null && (o.delivery_status === "claimed" || o.delivery_status === "collected"),
    canCall: o.courier_name !== null && o.status === "out_for_delivery" && o.fulfilment === "delivery",
  });
});

// GET /api/orders/:id/messages - the chat with the courier (or, for the courier, with the customer).
// Opening it marks the other person's messages as read.
trackingRouter.get("/:id/messages", requireAuth, async (req, res) => {
  const who = Number.isInteger(Number(req.params.id)) ? await chatRole(Number(req.params.id), req.user!.id) : null;
  if (!who) return res.status(404).json({ error: "Order not found." });
  await pool.query("UPDATE delivery_messages SET read_at = now() WHERE order_id = $1 AND sender_id <> $2 AND read_at IS NULL", [
    who.orderId,
    req.user!.id,
  ]);
  const m = await pool.query("SELECT id, sender_id, body, is_outside, created_at FROM delivery_messages WHERE order_id = $1 ORDER BY id", [who.orderId]);
  res.json({
    canSend: who.canSend,
    otherName: who.otherName,
    messages: m.rows.map((x) => ({ id: Number(x.id), mine: Number(x.sender_id) === req.user!.id, text: x.body, outside: x.is_outside, at: x.created_at })),
  });
});

const MESSAGES_PER_10_MIN = 30; // per person per order: plenty for a delivery, stops a flood

// POST /api/orders/:id/messages { text } - only while a courier has the order.
trackingRouter.post("/:id/messages", requireAuth, async (req, res) => {
  const who = Number.isInteger(Number(req.params.id)) ? await chatRole(Number(req.params.id), req.user!.id) : null;
  if (!who) return res.status(404).json({ error: "Order not found." });
  if (!who.canSend || who.otherId === null) {
    return res.status(409).json({ error: "You can message the courier once one is delivering your order." });
  }
  const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
  if (text.length < 1 || text.length > 500) return res.status(422).json({ error: "Write a message of up to 500 characters." });
  const recent = await pool.query(
    "SELECT count(*)::int AS n FROM delivery_messages WHERE order_id = $1 AND sender_id = $2 AND created_at > now() - interval '10 minutes'",
    [who.orderId, req.user!.id]
  );
  if (recent.rows[0].n >= MESSAGES_PER_10_MIN) return res.status(429).json({ error: "That's a lot of messages. Please call instead." });
  const id = await sendDeliveryMessage({ orderId: who.orderId, senderId: req.user!.id, recipientId: who.otherId, body: text });
  res.status(201).json({ id });
});

// POST /api/orders/:id/location { lat, lng } - "Share where I am" from the tracking page, for a customer who
// didn't drop a pin at checkout (or wants to move it). Until the order is delivered.
trackingRouter.post("/:id/location", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(404).json({ error: "Order not found." });
  const p = parsePoint(req.body);
  if (!p || !inServiceArea(p)) {
    return res.status(422).json({ error: "That pin is outside the area we deliver to. Move it to where you are." });
  }
  const r = await pool.query(
    `UPDATE orders SET delivery_lat = $3, delivery_lng = $4, updated_at = now()
      WHERE id = $1 AND consumer_id = $2 AND fulfilment <> 'pickup' AND status = ANY($5)
      RETURNING id`,
    [id, req.user!.id, p.lat, p.lng, ACTIVE]
  );
  if (r.rowCount === 0) return res.status(404).json({ error: "This order can't take a pin any more." });
  res.json({ location: p });
});
