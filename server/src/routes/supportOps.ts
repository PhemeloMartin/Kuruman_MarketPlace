import { Request, Response, Router } from "express";
import { PoolClient } from "pg";
import { pool } from "../db";
import { requireStaff } from "../auth/session";
import { audit } from "../lib/audit";
import { openOrderCase } from "../lib/cases";
import { recordStatusChange, releaseReservation } from "../lib/stock";
import { closeCase, inTransaction, reasonFrom } from "./supportShared";

// Delivery and order problems in the support console (spec FR-15, FR-16, BR-10, UC-13).
// Mounted at /api/support/ops; everything here needs the "operations" scope.
//
// Case kinds:
//   fulfilment / why = delivery_failed - the courier couldn't hand it over and still has the goods
//   fulfilment / why = no_courier      - nobody took the delivery job within 30 minutes
//   order_problem                      - the customer reported a problem after receiving the order
export const supportOpsRouter = Router();
supportOpsRouter.use(requireStaff("operations"));

// GET /api/support/ops/cases - open cases first, then the 20 most recently closed.
// Phone numbers and addresses are NOT included here; see /contacts below.
supportOpsRouter.get("/cases", async (_req, res) => {
  const cases = await pool.query(
    `(SELECT c.*, r.display_name AS resolved_by_name FROM support_cases c LEFT JOIN users r ON r.id = c.resolved_by
       WHERE c.case_type IN ('fulfilment', 'order_problem') AND c.status = 'open' ORDER BY c.created_at)
     UNION ALL
     (SELECT c.*, r.display_name AS resolved_by_name FROM support_cases c LEFT JOIN users r ON r.id = c.resolved_by
       WHERE c.case_type IN ('fulfilment', 'order_problem') AND c.status = 'closed' ORDER BY c.closed_at DESC LIMIT 20)`
  );
  const out = [];
  for (const c of cases.rows) {
    const o = await pool.query(
      `SELECT o.id, o.order_number, o.status, o.fulfilment, o.payment_method, o.total_cents,
              b.name AS business_name, cu.display_name AS customer_name,
              d.status AS delivery_status, d.failed_reason, d.returned_at, co.display_name AS courier_name,
              EXISTS (SELECT 1 FROM payments p WHERE p.order_id = o.id AND p.status = 'paid') AS paid_online,
              (SELECT json_agg(json_build_object('name', i.product_name, 'quantity', i.quantity) ORDER BY i.id)
                 FROM order_items i WHERE i.order_id = o.id) AS items
         FROM orders o JOIN businesses b ON b.id = o.business_id JOIN users cu ON cu.id = o.consumer_id
         LEFT JOIN deliveries d ON d.order_id = o.id LEFT JOIN users co ON co.id = d.courier_id
        WHERE o.id = $1`,
      [c.order_id]
    );
    const x = o.rows[0];
    const notes = await pool.query(
      `SELECT a.reason, a.occurred_at, u.display_name FROM audit_events a LEFT JOIN users u ON u.id = a.actor_user_id
        WHERE a.resource_type = 'support_case' AND a.resource_id = $1 AND a.action = 'case.note' ORDER BY a.id`,
      [String(c.id)]
    );
    out.push({
      id: Number(c.id),
      type: c.case_type,
      status: c.status,
      details: c.details,
      createdAt: c.created_at,
      closedAt: c.closed_at,
      resolution: c.resolution,
      reason: c.resolution_reason,
      resolvedBy: c.resolved_by_name,
      order: {
        id: Number(x.id),
        number: x.order_number,
        status: x.status,
        fulfilment: x.fulfilment,
        paymentMethod: x.payment_method,
        paidOnline: x.paid_online,
        totalCents: x.total_cents,
        businessName: x.business_name,
        customerName: x.customer_name,
        items: x.items ?? [],
      },
      delivery: x.delivery_status
        ? { status: x.delivery_status, courierName: x.courier_name, failedReason: x.failed_reason, returnedAt: x.returned_at }
        : null,
      notes: notes.rows.map((n) => ({ text: n.reason, at: n.occurred_at, by: n.display_name })),
    });
  }
  res.json(out);
});

// POST /api/support/ops/cases/:id/contacts - phone numbers (and the delivery address) for
// the people on this order. Only on request, and every look is written to the audit log
// (spec BR-13: "privileged cases require purpose-scoped access").
supportOpsRouter.post("/cases/:id/contacts", async (req, res) => {
  const id = Number(req.params.id);
  const r = Number.isInteger(id)
    ? await pool.query(
        `SELECT o.delivery_address, cu.display_name AS customer_name, cu.phone AS customer_phone,
                b.name AS business_name, b.phone AS business_phone,
                co.display_name AS courier_name, co.phone AS courier_phone
           FROM support_cases c JOIN orders o ON o.id = c.order_id
           JOIN users cu ON cu.id = o.consumer_id JOIN businesses b ON b.id = o.business_id
           LEFT JOIN deliveries d ON d.order_id = o.id LEFT JOIN users co ON co.id = d.courier_id
          WHERE c.id = $1 AND c.case_type IN ('fulfilment', 'order_problem')`,
        [id]
      )
    : { rows: [] as any[] };
  const x = r.rows[0];
  if (!x) return res.status(404).json({ error: "Case not found." });
  await audit(pool, { actorId: req.user!.id, action: "case.view_contacts", resourceType: "support_case", resourceId: id, outcome: "success" });
  res.json({
    customer: { name: x.customer_name, phone: x.customer_phone, address: x.delivery_address },
    business: { name: x.business_name, phone: x.business_phone },
    courier: x.courier_name ? { name: x.courier_name, phone: x.courier_phone } : null,
  });
});

// Loads an OPEN ops case plus its order, both locked (case first, then order).
async function lockCaseAndOrder(client: PoolClient, req: Request, res: Response) {
  const id = Number(req.params.id);
  const r = Number.isInteger(id)
    ? await client.query(
        "SELECT * FROM support_cases WHERE id = $1 AND case_type IN ('fulfilment', 'order_problem') FOR UPDATE",
        [id]
      )
    : { rows: [] as any[] };
  const c = r.rows[0];
  if (!c) {
    res.status(404).json({ error: "Case not found." });
    return null;
  }
  if (c.status !== "open") {
    res.status(409).json({ error: "This case is already closed. Refresh the list." });
    return null;
  }
  const o = await client.query("SELECT id, status, consumer_id FROM orders WHERE id = $1 FOR UPDATE", [c.order_id]);
  const d = await client.query("SELECT id, status, returned_at FROM deliveries WHERE order_id = $1 FOR UPDATE", [c.order_id]);
  return { c, order: { ...o.rows[0], id: Number(o.rows[0].id) }, delivery: d.rows[0] ?? null };
}

// Money captured online for this order must go back: open a refund case (stage 2 handles it).
async function refundIfPaidOnline(client: PoolClient, order: { id: number; consumer_id: string }, why: string, staffId: number) {
  const p = await client.query("SELECT 1 FROM payments WHERE order_id = $1 AND status = 'paid'", [order.id]);
  if (p.rowCount === 0) return false;
  await openOrderCase(client, { type: "refund", orderId: order.id, requesterId: Number(order.consumer_id), details: { why }, actorId: staffId });
  return true;
}

// POST /api/support/ops/cases/:id/retry { reason } - after a failed delivery, the same courier
// tries again (e.g. a new time agreed with the customer). The customer can show a new code.
supportOpsRouter.post("/cases/:id/retry", async (req, res) => {
  const reason = reasonFrom(req, res);
  if (!reason) return;
  await inTransaction(async (client) => {
    const found = await lockCaseAndOrder(client, req, res);
    if (!found) return;
    const { c, order, delivery } = found;
    if (order.status !== "delivery_failed" || delivery?.status !== "failed" || delivery.returned_at) {
      return void res.status(409).json({ error: "This order isn't waiting for a new delivery attempt." });
    }
    await client.query("UPDATE deliveries SET status = 'collected', failed_reason = NULL, failed_at = NULL WHERE id = $1", [delivery.id]);
    await client.query("UPDATE orders SET status = 'out_for_delivery', updated_at = now() WHERE id = $1", [order.id]);
    await recordStatusChange(client, order.id, "delivery_failed", "out_for_delivery", req.user!.id, `New delivery attempt: ${reason}`);
    await closeCase(client, Number(c.id), "retry", reason, req.user!.id);
    await audit(client, { actorId: req.user!.id, action: "order.retry_delivery", resourceType: "order", resourceId: order.id, outcome: "success", reason });
    res.json({ status: "out_for_delivery" });
  });
});

// POST /api/support/ops/cases/:id/cancel-order { reason } (UC-13)
//   - not yet collected (no courier came): the held stock is released straight away;
//   - after a failed delivery: the courier brings the goods back and the seller inspects them.
// If the customer paid online, a refund case opens in the same transaction.
supportOpsRouter.post("/cases/:id/cancel-order", async (req, res) => {
  const reason = reasonFrom(req, res);
  if (!reason) return;
  await inTransaction(async (client) => {
    const found = await lockCaseAndOrder(client, req, res);
    if (!found) return;
    const { c, order, delivery } = found;
    const notCollected = order.status === "ready" && delivery && ["open", "claimed"].includes(delivery.status);
    const failed = order.status === "delivery_failed";
    if (c.case_type !== "fulfilment" || (!notCollected && !failed)) {
      return void res.status(409).json({ error: "This order can't be cancelled from here any more." });
    }
    if (notCollected) {
      await releaseReservation(client, order.id);
      await client.query("UPDATE deliveries SET status = 'cancelled' WHERE id = $1", [delivery.id]);
    }
    await client.query(
      "UPDATE orders SET status = 'cancelled', handover_code_hash = NULL, handover_code_expires_at = NULL, updated_at = now() WHERE id = $1",
      [order.id]
    );
    await recordStatusChange(client, order.id, order.status, "cancelled", req.user!.id, `Cancelled by support: ${reason}`);
    const refundOpened = await refundIfPaidOnline(client, order, "order_cancelled", req.user!.id);
    await closeCase(client, Number(c.id), "cancelled", reason, req.user!.id);
    await audit(client, {
      actorId: req.user!.id,
      action: "order.cancel",
      resourceType: "order",
      resourceId: order.id,
      outcome: "success",
      reason,
      changes: { from: order.status, stockReleased: Boolean(notCollected), refundCaseOpened: refundOpened },
    });
    res.json({ status: "cancelled", refundCaseOpened: refundOpened });
  });
});

// POST /api/support/ops/cases/:id/refund { reason } - a customer's problem is upheld: hand the
// money side to the refund queue (the payments team does and evidences the actual refund).
supportOpsRouter.post("/cases/:id/refund", async (req, res) => {
  const reason = reasonFrom(req, res);
  if (!reason) return;
  await inTransaction(async (client) => {
    const found = await lockCaseAndOrder(client, req, res);
    if (!found) return;
    const { c, order } = found;
    if (c.case_type !== "order_problem") {
      return void res.status(409).json({ error: "Use cancel for delivery cases." });
    }
    const opened = await refundIfPaidOnline(client, order, "customer_problem", req.user!.id);
    if (!opened) {
      return void res.status(409).json({
        error: "This order wasn't paid online. Arrange a cash return with the seller and record it in a note.",
      });
    }
    await closeCase(client, Number(c.id), "refund", reason, req.user!.id);
    await audit(client, { actorId: req.user!.id, action: "case.refund_requested", resourceType: "support_case", resourceId: c.id, outcome: "success", reason });
    res.json({ status: "refund_case_opened" });
  });
});

// POST /api/support/ops/cases/:id/close { reason } - e.g. a courier took the job after all, or the
// problem was sorted out without money. A failed delivery can't be closed without a decision.
supportOpsRouter.post("/cases/:id/close", async (req, res) => {
  const reason = reasonFrom(req, res);
  if (!reason) return;
  await inTransaction(async (client) => {
    const found = await lockCaseAndOrder(client, req, res);
    if (!found) return;
    if (found.order.status === "delivery_failed") {
      return void res.status(409).json({ error: "Decide first: try the delivery again, or cancel the order." });
    }
    await closeCase(client, Number(found.c.id), "resolved", reason, req.user!.id);
    await audit(client, { actorId: req.user!.id, action: "case.close", resourceType: "support_case", resourceId: found.c.id, outcome: "success", reason });
    res.json({ status: "closed" });
  });
});

supportOpsRouter.post("/cases/:id/notes", async (req, res) => {
  const note = reasonFrom(req, res);
  if (!note) return;
  const id = Number(req.params.id);
  const c = Number.isInteger(id)
    ? await pool.query("SELECT id FROM support_cases WHERE id = $1 AND case_type IN ('fulfilment', 'order_problem')", [id])
    : { rows: [] as any[] };
  if (!c.rows[0]) return res.status(404).json({ error: "Case not found." });
  await audit(pool, { actorId: req.user!.id, action: "case.note", resourceType: "support_case", resourceId: id, outcome: "success", reason: note });
  res.status(201).json({ ok: true });
});
