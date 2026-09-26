import crypto from "crypto";
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { pool } from "../db";
import { openOrderCase } from "../lib/cases";
import { requireRole } from "../auth/session";
import { POLICY } from "../lib/policy";
import { recordStatusChange, releaseReservation } from "../lib/stock";
import { HANDOVER_CODE_MINUTES, hashHandoverCode, newHandoverCode } from "../lib/handover";

export const ordersRouter = Router();

// Support staff don't shop; everyone else can (an entrepreneur may buy from other businesses).
const shopper = requireRole("consumer", "entrepreneur", "courier");

interface OrderRequest {
  businessId: number;
  items: { productId: number; quantity: number }[];
  fulfilment: "pickup" | "delivery";
  paymentMethod: "cash" | "online";
  deliveryAddress: string | null;
  notes: string | null;
  expectedTotalCents: number | null;
}

// Checks the shape of the request. Prices and totals are NOT taken from the browser -
// the server works them out from the database (business rule 13).
function parseOrder(body: any): { order?: OrderRequest; fields: Record<string, string> } {
  const fields: Record<string, string> = {};
  const items = Array.isArray(body?.items) ? body.items : [];

  if (items.length === 0) fields.items = "Your cart is empty.";
  if (items.length > POLICY.maxLinesPerOrder) fields.items = `At most ${POLICY.maxLinesPerOrder} different items per order.`;

  const seen = new Set<number>();
  for (const it of items) {
    const ok =
      Number.isInteger(it?.productId) &&
      Number.isInteger(it?.quantity) &&
      it.quantity >= 1 &&
      it.quantity <= POLICY.maxQuantityPerLine;
    if (!ok || seen.has(it.productId)) {
      fields.items = `Each item needs a quantity from 1 to ${POLICY.maxQuantityPerLine}.`;
      break;
    }
    seen.add(it.productId);
  }

  const fulfilment = body?.fulfilment;
  if (fulfilment !== "pickup" && fulfilment !== "delivery") fields.fulfilment = "Choose delivery or pickup.";

  const paymentMethod = body?.paymentMethod;
  if (paymentMethod !== "cash" && paymentMethod !== "online") fields.paymentMethod = "Choose how you will pay.";
  else if (paymentMethod === "online" && !POLICY.onlinePaymentAvailable) {
    fields.paymentMethod = "Online payment isn't available yet. Please choose cash.";
  }

  const address = typeof body?.deliveryAddress === "string" ? body.deliveryAddress.trim() : "";
  if (fulfilment === "delivery" && (address.length < 5 || address.length > 300)) {
    fields.deliveryAddress = "Enter the delivery address, with a landmark if it helps (5 to 300 characters).";
  }

  const notes = typeof body?.notes === "string" ? body.notes.trim().slice(0, 300) : "";

  if (Object.keys(fields).length > 0) return { fields };
  return {
    fields,
    order: {
      businessId: Number(body.businessId),
      items: [...items].sort((a, b) => a.productId - b.productId),
      fulfilment,
      paymentMethod,
      deliveryAddress: fulfilment === "delivery" ? address : null,
      notes: notes || null,
      expectedTotalCents: Number.isInteger(body?.expectedTotalCents) ? body.expectedTotalCents : null,
    },
  };
}

function hashRequest(o: OrderRequest): string {
  const { expectedTotalCents: _ignored, ...rest } = o;
  return crypto.createHash("sha256").update(JSON.stringify(rest)).digest("hex");
}

// POST /api/orders - submit an order and reserve its stock (spec TX-01, FR-09).
ordersRouter.post("/", shopper, async (req, res) => {
  const idempotencyKey = req.get("Idempotency-Key") ?? "";
  if (!/^[A-Za-z0-9-]{8,64}$/.test(idempotencyKey)) {
    return res.status(400).json({ error: "Missing request key. Please refresh and try again." });
  }

  const { order, fields } = parseOrder(req.body);
  if (!order) return res.status(422).json({ error: "Please check your order.", fields });

  const consumerId = req.user!.id;
  const requestHash = hashRequest(order);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 1. Same key seen before? Then this is a repeat of the same tap - return the original order.
    const previous = await client.query(
      "SELECT id, order_number, request_hash FROM orders WHERE consumer_id = $1 AND idempotency_key = $2",
      [consumerId, idempotencyKey]
    );
    if (previous.rowCount) {
      await client.query("ROLLBACK");
      const p = previous.rows[0];
      if (p.request_hash !== requestHash) {
        return res.status(409).json({ error: "This order was already sent with different items. Please review your cart." });
      }
      return res.status(200).json({ id: Number(p.id), orderNumber: p.order_number, repeated: true });
    }

    // 2. Lock the products in id order. Anyone else ordering the same products now waits
    //    here until we commit, so two people can never both reserve the last item.
    const ids = order.items.map((i) => i.productId);
    const products = await client.query(
      `SELECT p.id, p.business_id, p.name, p.unit_label, p.price_cents, p.stock_qty, p.reserved_qty,
              p.is_active, b.is_active AS business_active, b.owner_id
         FROM products p JOIN businesses b ON b.id = p.business_id
        WHERE p.id = ANY($1::bigint[])
        ORDER BY p.id
          FOR UPDATE OF p`,
      [ids]
    );
    const byId = new Map(products.rows.map((p) => [Number(p.id), p]));

    // One seller per order (business rule 1) - checked here too, not just in the app.
    if (products.rows.some((p) => Number(p.business_id) !== order.businessId)) {
      await client.query("ROLLBACK");
      return res.status(422).json({ error: "Each order can only contain items from one seller." });
    }

    // 3. Check every line against what's really in the database.
    const problems: { productId: number; name: string | null; availableQty: number }[] = [];
    let subtotalCents = 0;
    for (const item of order.items) {
      const p = byId.get(item.productId);
      if (!p || !p.is_active || !p.business_active || Number(p.business_id) !== order.businessId) {
        problems.push({ productId: item.productId, name: p?.name ?? null, availableQty: 0 });
        continue;
      }
      const available = p.stock_qty - p.reserved_qty;
      if (item.quantity > available) {
        problems.push({ productId: item.productId, name: p.name, availableQty: Math.max(available, 0) });
      }
      subtotalCents += p.price_cents * item.quantity;
    }

    if (problems.length) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        error: "Some items are no longer available in that quantity. Please review your cart.",
        code: "STOCK_CHANGED",
        problems,
      });
    }

    const firstProduct = byId.get(order.items[0].productId);
    if (Number(firstProduct.owner_id) === consumerId) {
      await client.query("ROLLBACK");
      return res.status(422).json({ error: "You can't order from your own business." });
    }

    const deliveryFeeCents = order.fulfilment === "delivery" ? POLICY.deliveryFeeCents : 0;
    const totalCents = subtotalCents + deliveryFeeCents;

    if (totalCents > POLICY.maxOrderTotalCents) {
      await client.query("ROLLBACK");
      return res.status(422).json({ error: "Orders are limited to R10 000 during the pilot." });
    }

    // Prices changed since the shopper looked? Tell them instead of charging a different amount.
    if (order.expectedTotalCents !== null && order.expectedTotalCents !== totalCents) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        error: "Prices have changed since you added these items. Please check the new total.",
        code: "PRICE_CHANGED",
        totalCents,
      });
    }

    // 4. Reserve the stock. (The CHECK reserved_qty <= stock_qty in the schema is a second safety net.)
    for (const item of order.items) {
      await client.query("UPDATE products SET reserved_qty = reserved_qty + $2, updated_at = now() WHERE id = $1", [
        item.productId,
        item.quantity,
      ]);
    }

    // 5. Write the order, its items (with a snapshot of name/unit/price) and its first history row.
    const created = await client.query(
      `INSERT INTO orders (consumer_id, business_id, fulfilment, payment_method, subtotal_cents,
                           delivery_fee_cents, total_cents, delivery_address, notes, accept_by,
                           idempotency_key, request_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now() + make_interval(mins => $10), $11, $12)
       RETURNING id, order_number, accept_by`,
      [
        consumerId,
        order.businessId,
        order.fulfilment,
        order.paymentMethod,
        subtotalCents,
        deliveryFeeCents,
        totalCents,
        order.deliveryAddress,
        order.notes,
        POLICY.sellerResponseMinutes,
        idempotencyKey,
        requestHash,
      ]
    );
    const orderId = Number(created.rows[0].id);

    for (const item of order.items) {
      const p = byId.get(item.productId);
      await client.query(
        `INSERT INTO order_items (order_id, product_id, product_name, unit_label, unit_price_cents, quantity, line_total_cents)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [orderId, item.productId, p.name, p.unit_label, p.price_cents, item.quantity, p.price_cents * item.quantity]
      );
    }
    await recordStatusChange(client, orderId, null, "pending_acceptance", consumerId);

    await client.query("COMMIT");
    res.status(201).json({
      id: orderId,
      orderNumber: created.rows[0].order_number,
      acceptBy: created.rows[0].accept_by,
      totalCents,
    });
  } catch (err: any) {
    await client.query("ROLLBACK");
    // Two identical taps raced each other and the other one won - return that order.
    if (err.code === "23505" && String(err.constraint).includes("idempotency")) {
      const p = await pool.query(
        "SELECT id, order_number FROM orders WHERE consumer_id = $1 AND idempotency_key = $2",
        [consumerId, idempotencyKey]
      );
      return res.status(200).json({ id: Number(p.rows[0].id), orderNumber: p.rows[0].order_number, repeated: true });
    }
    throw err;
  } finally {
    client.release();
  }
});

// GET /api/orders/mine - the signed-in shopper's own orders only (business rule 13).
ordersRouter.get("/mine", shopper, async (req, res) => {
  const r = await pool.query(
    `SELECT o.id, o.order_number, o.status, o.fulfilment, o.payment_method, o.subtotal_cents,
            o.delivery_fee_cents, o.total_cents, o.accept_by, o.created_at, o.payment_due_at,
            -- The payment applied to the order wins; otherwise the latest attempt (e.g. a late one).
            (SELECT p.status FROM payments p WHERE p.order_id = o.id
              ORDER BY p.status = 'paid' DESC, p.id DESC LIMIT 1) AS payment_status,
            -- Refunds shown separately: "being processed" is never presented as "refunded" (FR-16).
            (SELECT COALESCE(sum(f.amount_cents), 0)::int FROM refunds f WHERE f.order_id = o.id AND f.status = 'succeeded') AS refunded_cents,
            (SELECT COALESCE(sum(f.amount_cents), 0)::int FROM refunds f WHERE f.order_id = o.id AND f.status = 'pending') AS refund_pending_cents,
            EXISTS (SELECT 1 FROM support_cases c WHERE c.order_id = o.id AND c.case_type = 'order_problem'
                     AND c.status = 'open') AS problem_reported,
            -- A problem can be reported for 7 days after completion (spec FR-16: later requests use a case).
            (o.status = 'completed' AND o.updated_at > now() - interval '7 days') AS can_report_problem,
            b.name AS business_name, b.area AS business_area,
            (SELECT cu.display_name FROM deliveries d JOIN users cu ON cu.id = d.courier_id
              WHERE d.order_id = o.id) AS courier_name,
            (SELECT h.reason FROM order_status_history h
              WHERE h.order_id = o.id ORDER BY h.id DESC LIMIT 1) AS status_reason,
            COALESCE(json_agg(json_build_object(
              'name', i.product_name, 'unitLabel', i.unit_label, 'quantity', i.quantity,
              'unitPriceCents', i.unit_price_cents, 'lineTotalCents', i.line_total_cents
            ) ORDER BY i.id), '[]') AS items
       FROM orders o
       JOIN businesses b ON b.id = o.business_id
       JOIN order_items i ON i.order_id = o.id
      WHERE o.consumer_id = $1
      GROUP BY o.id, b.name, b.area
      ORDER BY o.created_at DESC
      LIMIT 50`,
    [req.user!.id]
  );
  res.json(
    r.rows.map((o) => ({
      id: Number(o.id),
      orderNumber: o.order_number,
      status: o.status,
      fulfilment: o.fulfilment,
      paymentMethod: o.payment_method,
      subtotalCents: o.subtotal_cents,
      deliveryFeeCents: o.delivery_fee_cents,
      totalCents: o.total_cents,
      acceptBy: o.accept_by,
      createdAt: o.created_at,
      paymentDueAt: o.payment_due_at,
      paymentStatus: o.payment_status,
      refundedCents: o.refunded_cents,
      refundPendingCents: o.refund_pending_cents,
      problemReported: o.problem_reported,
      canReportProblem: o.can_report_problem && !o.problem_reported,
      businessName: o.business_name,
      businessArea: o.business_area,
      courierName: o.courier_name,
      statusReason: o.status_reason,
      items: o.items,
    }))
  );
});

// POST /api/orders/:id/problem { description } - something was wrong with a completed order
// (spec FR-16, UC-13). It opens a case for support; nothing about the order or money changes here.
ordersRouter.post("/:id/problem", shopper, async (req, res) => {
  const orderId = Number(req.params.id);
  const description = typeof req.body?.description === "string" ? req.body.description.trim() : "";
  if (description.length < 10 || description.length > 500) {
    return res.status(422).json({ error: "Tell us what went wrong (10 to 500 characters).", fields: { description: "10 to 500 characters." } });
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const r = await client.query(
      `SELECT id, status, updated_at > now() - interval '7 days' AS recent FROM orders
        WHERE id = $1 AND consumer_id = $2 FOR UPDATE`,
      [orderId, req.user!.id]
    );
    const order = r.rows[0];
    if (!order) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Order not found." });
    }
    if (order.status !== "completed" || !order.recent) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Problems can be reported for 7 days after you receive an order." });
    }
    await openOrderCase(client, {
      type: "order_problem",
      orderId,
      requesterId: req.user!.id,
      details: { description },
      actorId: req.user!.id,
    });
    await client.query("COMMIT");
    res.status(201).json({ reported: true });
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
});

// POST /api/orders/:id/cancel - a shopper may cancel while the seller hasn't decided yet (BR-12).
ordersRouter.post("/:id/cancel", shopper, async (req, res) => {
  const orderId = Number(req.params.id);
  if (!Number.isInteger(orderId)) return res.status(404).json({ error: "Order not found." });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Lock the order so the seller can't accept it at the same moment we cancel it.
    const r = await client.query("SELECT id, status, consumer_id FROM orders WHERE id = $1 FOR UPDATE", [orderId]);
    const order = r.rows[0];
    // Someone else's order gets the same "not found" answer - we don't reveal it exists.
    if (!order || Number(order.consumer_id) !== req.user!.id) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Order not found." });
    }
    if (order.status !== "pending_acceptance") {
      await client.query("ROLLBACK");
      const error =
        order.status === "cancelled"
          ? "This order is already cancelled."
          : "The seller has already responded, so this order can't be cancelled here.";
      return res.status(409).json({ error });
    }

    await releaseReservation(client, orderId);
    await client.query("UPDATE orders SET status = 'cancelled', updated_at = now() WHERE id = $1", [orderId]);
    await recordStatusChange(client, orderId, "pending_acceptance", "cancelled", req.user!.id, "Cancelled by customer");
    await client.query("COMMIT");
    res.json({ status: "cancelled" });
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
});

// POST /api/orders/:id/handover-code - the customer gets a fresh one-time code to show the
// seller at collection (FR-13). A new code replaces the old one and resets the wrong-try count.
// The plain code is returned only here, only to the order's own customer.
// Spec 9.2: code issuance is rate-limited.
const codeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many new codes requested. Please wait a few minutes." },
});

ordersRouter.post("/:id/handover-code", codeLimiter, shopper, async (req, res) => {
  const orderId = Number(req.params.id);
  if (!Number.isInteger(orderId)) return res.status(404).json({ error: "Order not found." });

  const code = newHandoverCode();
  const r = await pool.query(
    `UPDATE orders
        SET handover_code_hash = $3,
            handover_code_expires_at = now() + make_interval(mins => $4),
            handover_failed_attempts = 0
      WHERE id = $1 AND consumer_id = $2
        AND ((status = 'ready' AND fulfilment = 'pickup')
          OR (status = 'out_for_delivery' AND fulfilment = 'delivery'))
      RETURNING handover_code_expires_at`,
    [orderId, req.user!.id, hashHandoverCode(orderId, code), HANDOVER_CODE_MINUTES]
  );
  if (r.rowCount === 0) {
    return res.status(409).json({
      error: "A code is available once your pickup order is ready, or your delivery is on its way.",
    });
  }
  res.json({ code, expiresAt: r.rows[0].handover_code_expires_at });
});
