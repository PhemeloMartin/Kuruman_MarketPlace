import { NextFunction, Request, Response, Router } from "express";
import { PoolClient } from "pg";
import { pool } from "../db";
import { requireRole } from "../auth/session";
import { computeKpis } from "../lib/kpi";
import { HANDOVER_MAX_ATTEMPTS, handoverCodeMatches } from "../lib/handover";
import { consumeReservation, recordStatusChange, releaseReservation } from "../lib/stock";

// Everything here is for an approved entrepreneur, and only ever about THEIR business.
// The business is looked up from the session user - never taken from the request (BR-13).
export const sellerRouter = Router();

declare global {
  namespace Express {
    interface Request {
      business?: { id: number; name: string };
    }
  }
}

async function loadMyBusiness(req: Request, res: Response, next: NextFunction) {
  const r = await pool.query("SELECT id, name FROM businesses WHERE owner_id = $1 AND is_active", [req.user!.id]);
  if (r.rowCount === 0) return res.status(403).json({ error: "You don't have an active business yet." });
  req.business = { id: Number(r.rows[0].id), name: r.rows[0].name };
  next();
}

sellerRouter.use(requireRole("entrepreneur"), loadMyBusiness);

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

// Reporting periods use South African time (spec 7.5: Africa/Johannesburg).
const PERIOD_START: Record<string, string> = {
  today: "date_trunc('day', now() AT TIME ZONE 'Africa/Johannesburg') AT TIME ZONE 'Africa/Johannesburg'",
  week: "date_trunc('week', now() AT TIME ZONE 'Africa/Johannesburg') AT TIME ZONE 'Africa/Johannesburg'",
  month: "date_trunc('month', now() AT TIME ZONE 'Africa/Johannesburg') AT TIME ZONE 'Africa/Johannesburg'",
};

sellerRouter.get("/dashboard", async (req, res) => {
  const period = typeof req.query.period === "string" && PERIOD_START[req.query.period] ? req.query.period : "week";
  const range = await pool.query(`SELECT ${PERIOD_START[period]} AS from, now() AS to`);
  const { from, to } = range.rows[0];

  const kpis = await computeKpis(pool, req.business!.id, from, to);
  res.json({ business: req.business, period, from, asOf: to, kpis });
});

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

sellerRouter.get("/orders", async (req, res) => {
  const r = await pool.query(
    `SELECT o.id, o.order_number, o.status, o.fulfilment, o.payment_method, o.subtotal_cents,
            o.delivery_fee_cents, o.total_cents, o.notes, o.accept_by, o.created_at, o.updated_at,
            u.display_name AS customer_name,
            (SELECT json_agg(json_build_object('name', i.product_name, 'unitLabel', i.unit_label,
                                               'quantity', i.quantity) ORDER BY i.id)
               FROM order_items i WHERE i.order_id = o.id) AS items
       FROM orders o
       JOIN users u ON u.id = o.consumer_id
      WHERE o.business_id = $1
        AND (o.status IN ('pending_acceptance', 'awaiting_payment', 'confirmed', 'ready', 'out_for_delivery')
             OR o.updated_at > now() - interval '3 days')
      ORDER BY o.accept_by ASC`,
    [req.business!.id]
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
      notes: o.notes,
      acceptBy: o.accept_by,
      createdAt: o.created_at,
      updatedAt: o.updated_at,
      // Minimum disclosure: the seller sees the customer's name, not their phone or address.
      customerName: o.customer_name,
      items: o.items ?? [],
    }))
  );
});

// Runs `work` inside a transaction with this business's order locked.
// Another business's order gets "not found", so we don't reveal that it exists.
async function withMyOrder(
  req: Request,
  res: Response,
  work: (client: PoolClient, order: any) => Promise<void>
): Promise<void> {
  const orderId = Number(req.params.id);
  if (!Number.isInteger(orderId)) {
    res.status(404).json({ error: "Order not found." });
    return;
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const r = await client.query(
      `SELECT id, status, fulfilment, payment_method, total_cents, delivery_fee_cents, business_id,
              accept_by <= now() AS overdue, handover_code_hash,
              handover_code_expires_at <= now() AS code_expired, handover_failed_attempts
         FROM orders WHERE id = $1 FOR UPDATE`,
      [orderId]
    );
    const order = r.rows[0];
    if (!order || Number(order.business_id) !== req.business!.id) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "Order not found." });
      return;
    }
    order.id = orderId;
    await work(client, order);
    // `work` may have already committed or rolled back; this is then a harmless no-op.
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// A stale screen (another tab, or the order changed meanwhile) gets a clear conflict, not a silent overwrite.
function conflict(res: Response, status: string) {
  const messages: Record<string, string> = {
    cancelled: "The customer cancelled this order.",
    expired: "This order expired because it wasn't answered within 30 minutes.",
    declined: "This order was already declined.",
    confirmed: "This order was already accepted.",
    awaiting_payment: "This order was already accepted.",
    ready: "This order is already marked as ready.",
    completed: "This order is already completed.",
  };
  res.status(409).json({ error: messages[status] ?? "This order has changed. Please refresh.", status });
}

// Accept (spec FR-10): cash -> confirmed (cash still due); online -> awaiting payment.
sellerRouter.post("/orders/:id/accept", (req, res) =>
  withMyOrder(req, res, async (client, order) => {
    if (order.status !== "pending_acceptance") return conflict(res, order.status);
    if (order.overdue) {
      // Too late: expire it now instead of accepting (the timer would do the same within a minute).
      await releaseReservation(client, order.id);
      await client.query("UPDATE orders SET status = 'expired', updated_at = now() WHERE id = $1", [order.id]);
      await recordStatusChange(client, order.id, "pending_acceptance", "expired", null, "Seller did not respond in time");
      await client.query("COMMIT");
      return conflict(res, "expired");
    }
    const next = order.payment_method === "cash" ? "confirmed" : "awaiting_payment";
    await client.query("UPDATE orders SET status = $2, updated_at = now() WHERE id = $1", [order.id, next]);
    await recordStatusChange(client, order.id, "pending_acceptance", next, req.user!.id);
    res.json({ status: next });
  })
);

// Decline needs a reason, which the customer will see (spec FR-10).
sellerRouter.post("/orders/:id/decline", (req, res) =>
  withMyOrder(req, res, async (client, order) => {
    const reason = typeof req.body?.reason === "string" ? req.body.reason.trim().slice(0, 200) : "";
    if (reason.length < 3) {
      await client.query("ROLLBACK");
      res.status(422).json({ error: "Please give the customer a reason.", fields: { reason: "Choose or type a reason." } });
      return;
    }
    if (order.status !== "pending_acceptance") return conflict(res, order.status);
    await releaseReservation(client, order.id);
    await client.query("UPDATE orders SET status = 'declined', updated_at = now() WHERE id = $1", [order.id]);
    await recordStatusChange(client, order.id, "pending_acceptance", "declined", req.user!.id, reason);
    res.json({ status: "declined" });
  })
);

// Mark ready (BR-09): only a CONFIRMED order. A delivery order now gets an open courier job;
// a pickup order never has a delivery row.
sellerRouter.post("/orders/:id/ready", (req, res) =>
  withMyOrder(req, res, async (client, order) => {
    if (order.status !== "confirmed") return conflict(res, order.status);
    await client.query("UPDATE orders SET status = 'ready', updated_at = now() WHERE id = $1", [order.id]);
    await recordStatusChange(client, order.id, "confirmed", "ready", req.user!.id);
    if (order.fulfilment === "delivery") {
      await client.query(
        `INSERT INTO deliveries (order_id, fee_cents, cash_to_collect_cents) VALUES ($1, $2, $3)`,
        [order.id, order.delivery_fee_cents, order.payment_method === "cash" ? order.total_cents : 0]
      );
    }
    res.json({ status: "ready" });
  })
);

// Complete a pickup (FR-13): the customer shows their one-time code, the seller types it in.
// In one transaction: check the code, use up the reserved stock, record the cash, complete the order.
sellerRouter.post("/orders/:id/pickup", (req, res) =>
  withMyOrder(req, res, async (client, order) => {
    const code = typeof req.body?.code === "string" ? req.body.code.replace(/\s/g, "") : "";
    if (order.fulfilment !== "pickup") {
      await client.query("ROLLBACK");
      res.status(422).json({ error: "This is a delivery order - the courier completes it." });
      return;
    }
    if (order.status !== "ready") return conflict(res, order.status);
    if (!order.handover_code_hash || order.code_expired) {
      await client.query("ROLLBACK");
      res.status(422).json({ error: "Ask the customer to open their order and show a new collection code." });
      return;
    }
    if (order.handover_failed_attempts >= HANDOVER_MAX_ATTEMPTS) {
      await client.query("ROLLBACK");
      res.status(423).json({ error: "Too many wrong codes. The customer needs to show a new code." });
      return;
    }
    if (!/^\d{6}$/.test(code) || !handoverCodeMatches(order.id, code, order.handover_code_hash)) {
      // Count the failed try and keep that count (COMMIT), even though the handover didn't happen.
      await client.query("UPDATE orders SET handover_failed_attempts = handover_failed_attempts + 1 WHERE id = $1", [order.id]);
      await client.query("COMMIT");
      const left = HANDOVER_MAX_ATTEMPTS - order.handover_failed_attempts - 1;
      res.status(422).json({
        error:
          left > 0
            ? `That code is not right. ${left} ${left === 1 ? "try" : "tries"} left.`
            : "That code is not right. The customer needs a new code.",
        fields: { code: "Wrong code." },
      });
      return;
    }

    await consumeReservation(client, order.id);
    if (order.payment_method === "cash") {
      // The seller received the cash in person, so it is collected and remitted at once.
      await client.query(
        `INSERT INTO cash_receipts (order_id, collected_by, collected_cents, remitted_cents, remitted_at)
         VALUES ($1, $2, $3, $3, now())`,
        [order.id, req.user!.id, order.total_cents]
      );
    }
    await client.query(
      `UPDATE orders SET status = 'completed', handover_code_hash = NULL, handover_code_expires_at = NULL,
              updated_at = now() WHERE id = $1`,
      [order.id]
    );
    await recordStatusChange(client, order.id, "ready", "completed", req.user!.id, "Collected by customer");
    res.json({ status: "completed" });
  })
);

// ---------------------------------------------------------------------------
// Products (listing management, spec FR-05 - basic version)
// ---------------------------------------------------------------------------

sellerRouter.get("/products", async (req, res) => {
  const r = await pool.query(
    `SELECT p.id, p.name, p.description, p.unit_label, p.price_cents, p.stock_qty, p.reserved_qty,
            p.low_stock_threshold, p.is_active, c.slug AS category, c.name AS category_name
       FROM products p JOIN categories c ON c.id = p.category_id
      WHERE p.business_id = $1
      ORDER BY p.is_active DESC, p.name`,
    [req.business!.id]
  );
  res.json(
    r.rows.map((p) => ({
      id: Number(p.id),
      name: p.name,
      description: p.description,
      unitLabel: p.unit_label,
      priceCents: p.price_cents,
      stockQty: p.stock_qty,
      reservedQty: p.reserved_qty,
      availableQty: p.stock_qty - p.reserved_qty,
      lowStockThreshold: p.low_stock_threshold,
      isActive: p.is_active,
      category: p.category,
      categoryName: p.category_name,
    }))
  );
});

function parseProduct(body: any, partial: boolean) {
  const fields: Record<string, string> = {};
  const out: Record<string, any> = {};
  const has = (k: string) => body?.[k] !== undefined;

  if (!partial || has("name")) {
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    if (name.length < 2 || name.length > 100) fields.name = "Name must be 2 to 100 characters.";
    out.name = name;
  }
  if (!partial || has("unitLabel")) {
    const unit = typeof body?.unitLabel === "string" ? body.unitLabel.trim() : "";
    if (unit.length < 1 || unit.length > 40) fields.unitLabel = "Say how it's sold, e.g. “1 loaf” or “1 x 2 kg bag”.";
    out.unit_label = unit;
  }
  if (!partial || has("priceCents")) {
    const price = body?.priceCents;
    if (!Number.isInteger(price) || price <= 0 || price > 1_000_000) fields.priceCents = "Enter a price above R0.";
    out.price_cents = price;
  }
  if (!partial || has("stockQty")) {
    const stock = body?.stockQty;
    if (!Number.isInteger(stock) || stock < 0 || stock > 100_000) fields.stockQty = "Stock must be 0 or more.";
    out.stock_qty = stock;
  }
  if (has("description")) {
    out.description = typeof body.description === "string" ? body.description.trim().slice(0, 1000) || null : null;
  }
  if (has("isActive")) out.is_active = Boolean(body.isActive);
  return { fields, out };
}

sellerRouter.post("/products", async (req, res) => {
  const { fields, out } = parseProduct(req.body, false);
  const cat = await pool.query("SELECT id FROM categories WHERE slug = $1", [req.body?.category]);
  if (cat.rowCount === 0) fields.category = "Choose a category.";
  if (Object.keys(fields).length) return res.status(422).json({ error: "Please check the highlighted fields.", fields });

  const r = await pool.query(
    `INSERT INTO products (business_id, category_id, name, description, unit_label, price_cents, stock_qty)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [req.business!.id, cat.rows[0].id, out.name, out.description ?? null, out.unit_label, out.price_cents, out.stock_qty]
  );
  res.status(201).json({ id: Number(r.rows[0].id) });
});

// Update price, stock, details, or hide/show. Past orders are unaffected: they keep their snapshot (BR-15).
sellerRouter.patch("/products/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { fields, out } = parseProduct(req.body, true);
  if (Object.keys(fields).length) return res.status(422).json({ error: "Please check the highlighted fields.", fields });
  if (Object.keys(out).length === 0) return res.status(422).json({ error: "Nothing to change." });

  const cols = Object.keys(out);
  const sets = cols.map((c, i) => `${c} = $${i + 3}`).join(", ");
  try {
    const r = await pool.query(
      `UPDATE products SET ${sets}, updated_at = now() WHERE id = $1 AND business_id = $2 RETURNING id`,
      [id, req.business!.id, ...cols.map((c) => out[c])]
    );
    if (r.rowCount === 0) return res.status(404).json({ error: "Product not found." });
    res.json({ id });
  } catch (err: any) {
    // The database refuses stock below what customers have already reserved.
    if (err.code === "23514") {
      return res.status(409).json({
        error: "Stock can't go below the units already reserved for open orders.",
        fields: { stockQty: "Too low for open orders." },
      });
    }
    throw err;
  }
});
