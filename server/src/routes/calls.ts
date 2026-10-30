import express, { Router } from "express";
import { pool } from "../db";
import { requireAuth } from "../auth/session";
import { audit } from "../lib/audit";
import { dialTwiml, sayTwiml, twilioConfigured, validTwilioSignature, voiceAccessToken } from "../lib/twilio";

// Free calls over mobile data: the caller pays nothing (no airtime); the platform pays Twilio per minute.
// Who may call whom is decided HERE, from the database - never by the browser:
//   - on an active order: the customer and the seller can call each other; the customer and the courier
//     too while the order is on its way;
//   - from a shop page: anyone signed in can call a shop that switched "free calls" on.
// The browser never sees a phone number. Limits keep the cost under control.
export const callsRouter = Router();

export const CALL_MAX_SECONDS = 300; // 5 minutes per call
const CALLS_PER_DAY = 10; // per person

callsRouter.get("/calls/config", (_req, res) => {
  res.json({ available: twilioConfigured(), maxMinutes: CALL_MAX_SECONDS / 60 });
});

type Target = { phone: string; orderId: number | null; businessId: number | null };

// Works out the number to call, or null if this person may not make this call.
async function findTarget(userId: number, body: any): Promise<Target | null> {
  if (Number.isInteger(body?.shopId)) {
    const r = await pool.query("SELECT id, phone FROM businesses WHERE id = $1 AND is_active AND calls_enabled", [body.shopId]);
    return r.rows[0] ? { phone: r.rows[0].phone, orderId: null, businessId: Number(r.rows[0].id) } : null;
  }
  if (!Number.isInteger(body?.orderId)) return null;
  const r = await pool.query(
    `SELECT o.id, o.consumer_id, o.status, o.updated_at > now() - interval '1 day' AS recent,
            b.id AS business_id, b.owner_id, b.phone AS shop_phone, cu.phone AS customer_phone,
            d.courier_id, co.phone AS courier_phone
       FROM orders o
       JOIN businesses b ON b.id = o.business_id
       JOIN users cu ON cu.id = o.consumer_id
       LEFT JOIN deliveries d ON d.order_id = o.id
       LEFT JOIN users co ON co.id = d.courier_id
      WHERE o.id = $1`,
    [body.orderId]
  );
  const o = r.rows[0];
  if (!o) return null;
  const active = ["pending_acceptance", "awaiting_payment", "confirmed", "ready", "out_for_delivery", "delivery_failed"].includes(o.status) ||
    (o.status === "completed" && o.recent);
  if (!active || !o.customer_phone) return null;
  const isCustomer = Number(o.consumer_id) === userId;
  const isSeller = Number(o.owner_id) === userId;
  const isCourier = o.courier_id !== null && Number(o.courier_id) === userId;
  const onTheWay = o.status === "out_for_delivery";
  const target = { orderId: Number(o.id), businessId: Number(o.business_id) };
  if (isCustomer && body.with === "seller") return { phone: o.shop_phone, ...target };
  if (isCustomer && body.with === "courier" && onTheWay && o.courier_phone) return { phone: o.courier_phone, ...target };
  if ((isSeller || (isCourier && onTheWay)) && body.with === "customer") return { phone: o.customer_phone, ...target };
  return null;
}

// POST /api/calls/start { orderId, with: "seller" | "customer" | "courier" } or { shopId }
// Answers with a short-lived token for the browser and the id of this call (no phone number).
callsRouter.post("/calls/start", requireAuth, async (req, res) => {
  if (!twilioConfigured()) return res.status(503).json({ error: "Free calls aren't available right now." });
  const target = await findTarget(req.user!.id, req.body);
  if (!target) return res.status(403).json({ error: "You can't call this person from here." });
  const today = await pool.query(
    "SELECT count(*)::int AS n FROM calls WHERE caller_id = $1 AND created_at > now() - interval '1 day'",
    [req.user!.id]
  );
  if (today.rows[0].n >= CALLS_PER_DAY) {
    return res.status(429).json({ error: `You've made ${CALLS_PER_DAY} free calls today. Please try again tomorrow.` });
  }
  const call = await pool.query(
    "INSERT INTO calls (caller_id, callee_phone, order_id, business_id) VALUES ($1, $2, $3, $4) RETURNING id",
    [req.user!.id, target.phone, target.orderId, target.businessId]
  );
  // Who called which order or shop is recorded; the number itself is not.
  await audit(pool, {
    actorId: req.user!.id,
    action: "call.start",
    resourceType: target.orderId ? "order" : "business",
    resourceId: target.orderId ?? target.businessId!,
    outcome: "success",
  });
  res.json({ callId: Number(call.rows[0].id), token: voiceAccessToken(`user-${req.user!.id}`), maxSeconds: CALL_MAX_SECONDS });
});

// POST /api/calls/twiml - Twilio asks how to connect a call the browser started. Signed by Twilio.
callsRouter.post("/calls/twiml", express.urlencoded({ extended: false }), async (req, res) => {
  res.type("text/xml");
  const url = `${(process.env.PUBLIC_APP_URL ?? "").trim()}/api/calls/twiml`;
  const params = Object.fromEntries(Object.entries(req.body ?? {}).map(([k, v]) => [k, String(v)]));
  if (!validTwilioSignature(url, params, req.get("X-Twilio-Signature") ?? "")) {
    return res.status(403).send(sayTwiml("Sorry, this call is not allowed."));
  }
  // Each call id works once, and only for 2 minutes after it was started.
  const r = await pool.query(
    `UPDATE calls SET connected_at = now()
      WHERE id = $1 AND connected_at IS NULL AND created_at > now() - interval '2 minutes'
      RETURNING callee_phone`,
    [Number(params.callId)]
  );
  if (r.rowCount === 0) return res.send(sayTwiml("Sorry, this call has expired. Please try again from KurumanMarketPlace."));
  res.send(dialTwiml(r.rows[0].callee_phone, CALL_MAX_SECONDS));
});
