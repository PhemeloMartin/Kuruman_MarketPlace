import { Request, Response, Router } from "express";
import { PoolClient } from "pg";
import { pool } from "../db";
import { requireStaff } from "../auth/session";
import { audit } from "../lib/audit";
import { closeCase, inTransaction, reasonFrom } from "./supportShared";

// Money exceptions in the support console (spec FR-16, FR-21, TX-04, BR-08, BR-11).
// Mounted at /api/support/money; everything here needs the "payments" scope.
//
// The rules the code below enforces:
//   - Refunds are separate records; a payment is never edited to hide what happened.
//   - Pending + succeeded refunds for a payment can never add up to more than it captured.
//     The payment row is locked while checking, so two staff members can't both refund it.
//   - A refund only counts as done with the provider's refund reference as evidence.
//   - A cash shortfall stays visible until the missing money is actually handed over.
export const supportMoneyRouter = Router();
supportMoneyRouter.use(requireStaff("payments"));

// ---------------------------------------------------------------------------
// Reading the cases
// ---------------------------------------------------------------------------

// How much of each captured payment is already refunded, reserved by a pending refund, or still refundable.
async function paymentsWithBalances(db: PoolClient | typeof pool, orderId: number) {
  const r = await db.query(
    `SELECT p.id, p.status, p.amount_cents, p.provider_reference, p.verified_at,
            COALESCE(sum(f.amount_cents) FILTER (WHERE f.status = 'succeeded'), 0)::int AS refunded_cents,
            COALESCE(sum(f.amount_cents) FILTER (WHERE f.status = 'pending'), 0)::int AS pending_cents
       FROM payments p LEFT JOIN refunds f ON f.payment_id = p.id
      WHERE p.order_id = $1 AND p.status IN ('paid', 'unapplied', 'refunded')
      GROUP BY p.id
      ORDER BY p.status = 'unapplied' DESC, p.id`, // money that MUST go back is listed first
    [orderId]
  );
  return r.rows.map((p) => ({
    id: Number(p.id),
    status: p.status as "paid" | "unapplied" | "refunded",
    amountCents: p.amount_cents,
    providerReference: p.provider_reference,
    verifiedAt: p.verified_at,
    refundedCents: p.refunded_cents,
    pendingCents: p.pending_cents,
    refundableCents: p.amount_cents - p.refunded_cents - p.pending_cents,
  }));
}

// GET /api/support/money/cases - open refund and cash cases, then the 20 most recent closed ones.
supportMoneyRouter.get("/cases", async (_req, res) => {
  const cases = await pool.query(
    `(SELECT c.*, o.order_number, o.status AS order_status, o.total_cents, o.payment_method,
             b.name AS business_name, cu.display_name AS customer_name, r.display_name AS resolved_by_name
        FROM support_cases c JOIN orders o ON o.id = c.order_id JOIN businesses b ON b.id = o.business_id
        JOIN users cu ON cu.id = o.consumer_id LEFT JOIN users r ON r.id = c.resolved_by
       WHERE c.case_type IN ('refund', 'cash_dispute') AND c.status = 'open'
       ORDER BY c.created_at)
     UNION ALL
     (SELECT c.*, o.order_number, o.status AS order_status, o.total_cents, o.payment_method,
             b.name AS business_name, cu.display_name AS customer_name, r.display_name AS resolved_by_name
        FROM support_cases c JOIN orders o ON o.id = c.order_id JOIN businesses b ON b.id = o.business_id
        JOIN users cu ON cu.id = o.consumer_id LEFT JOIN users r ON r.id = c.resolved_by
       WHERE c.case_type IN ('refund', 'cash_dispute') AND c.status = 'closed'
       ORDER BY c.closed_at DESC LIMIT 20)`
  );

  const out = [];
  for (const c of cases.rows) {
    const orderId = Number(c.order_id);
    const item: Record<string, unknown> = {
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
        id: orderId,
        number: c.order_number,
        status: c.order_status,
        totalCents: c.total_cents,
        paymentMethod: c.payment_method,
        businessName: c.business_name,
        customerName: c.customer_name,
      },
    };
    if (c.case_type === "refund") {
      item.payments = await paymentsWithBalances(pool, orderId);
      const f = await pool.query(
        `SELECT id, payment_id, purpose, amount_cents, status, provider_reference, reason, requested_at, completed_at
           FROM refunds WHERE order_id = $1 ORDER BY id`,
        [orderId]
      );
      item.refunds = f.rows.map((x) => ({
        id: Number(x.id),
        paymentId: Number(x.payment_id),
        purpose: x.purpose,
        amountCents: x.amount_cents,
        status: x.status,
        providerReference: x.provider_reference,
        reason: x.reason,
        requestedAt: x.requested_at,
        completedAt: x.completed_at,
      }));
    } else {
      const k = await pool.query(
        `SELECT k.collected_cents, k.remitted_cents, k.status, u.display_name AS courier_name
           FROM cash_receipts k JOIN users u ON u.id = k.collected_by WHERE k.order_id = $1`,
        [orderId]
      );
      const x = k.rows[0];
      item.cash = x && { collectedCents: x.collected_cents, remittedCents: x.remitted_cents, status: x.status, courierName: x.courier_name };
    }
    // Investigation notes live in the audit log, so they can't be edited later either.
    const notes = await pool.query(
      `SELECT a.reason, a.occurred_at, u.display_name FROM audit_events a LEFT JOIN users u ON u.id = a.actor_user_id
        WHERE a.resource_type = 'support_case' AND a.resource_id = $1 AND a.action = 'case.note' ORDER BY a.id`,
      [String(c.id)]
    );
    item.notes = notes.rows.map((n) => ({ text: n.reason, at: n.occurred_at, by: n.display_name }));
    out.push(item);
  }
  res.json(out);
});

// ---------------------------------------------------------------------------
// Shared: lock an open case of the expected kind
// ---------------------------------------------------------------------------

async function lockOpenCase(client: PoolClient, req: Request, res: Response, type: "refund" | "cash_dispute") {
  const id = Number(req.params.id);
  const r = Number.isInteger(id)
    ? await client.query("SELECT * FROM support_cases WHERE id = $1 AND case_type = $2 FOR UPDATE", [id, type])
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
  return c;
}

// ---------------------------------------------------------------------------
// Refunds (TX-04)
// ---------------------------------------------------------------------------

// POST /api/support/money/refund-cases/:id/refunds { paymentId, amountCents, reason }
// Starts a refund and reserves the amount. The actual money goes back through Payfast's
// merchant dashboard; staff then record Payfast's refund reference with "complete".
supportMoneyRouter.post("/refund-cases/:id/refunds", async (req, res) => {
  const reason = reasonFrom(req, res);
  if (!reason) return;
  const amount = req.body?.amountCents;
  if (!Number.isInteger(amount) || amount <= 0) {
    return res.status(422).json({ error: "Enter the amount to refund.", fields: { amountCents: "Enter an amount." } });
  }
  await inTransaction(async (client) => {
    const c = await lockOpenCase(client, req, res, "refund");
    if (!c) return;
    // Locking the payment row is what makes the cap safe: a second refund for the same
    // payment waits here until this transaction finishes, then sees the new total.
    const p = await client.query(
      "SELECT id, status, amount_cents FROM payments WHERE id = $1 AND order_id = $2 FOR UPDATE",
      [Number(req.body?.paymentId), c.order_id]
    );
    const payment = p.rows[0];
    if (!payment || !["paid", "unapplied"].includes(payment.status)) {
      return void res.status(409).json({ error: "That payment can't be refunded." });
    }
    const used = await client.query(
      "SELECT COALESCE(sum(amount_cents), 0)::int AS cents FROM refunds WHERE payment_id = $1 AND status IN ('pending', 'succeeded')",
      [payment.id]
    );
    const refundable = payment.amount_cents - used.rows[0].cents;
    if (amount > refundable) {
      return void res.status(409).json({
        error: `Only R${(refundable / 100).toFixed(2)} of this payment can still be refunded.`,
        refundableCents: refundable,
      });
    }
    const f = await client.query(
      `INSERT INTO refunds (order_id, payment_id, purpose, amount_cents, reason, requested_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [c.order_id, payment.id, payment.status === "unapplied" ? "unapplied_capture" : "order_refund", amount, reason, req.user!.id]
    );
    await audit(client, {
      actorId: req.user!.id,
      action: "refund.request",
      resourceType: "refund",
      resourceId: f.rows[0].id,
      outcome: "success",
      reason,
      changes: { paymentId: Number(payment.id), amountCents: amount },
    });
    res.status(201).json({ id: Number(f.rows[0].id), status: "pending" });
  });
});

// Loads a PENDING refund with it and its payment locked (payment first, like the request route).
async function lockPendingRefund(client: PoolClient, req: Request, res: Response) {
  const id = Number(req.params.id);
  const r = Number.isInteger(id) ? await client.query("SELECT payment_id FROM refunds WHERE id = $1", [id]) : { rows: [] as any[] };
  if (!r.rows[0]) {
    res.status(404).json({ error: "Refund not found." });
    return null;
  }
  const payment = (await client.query("SELECT id, amount_cents FROM payments WHERE id = $1 FOR UPDATE", [r.rows[0].payment_id])).rows[0];
  const refund = (await client.query("SELECT * FROM refunds WHERE id = $1 FOR UPDATE", [id])).rows[0];
  if (refund.status !== "pending") {
    res.status(409).json({ error: "This refund has already been finished." });
    return null;
  }
  return { refund, payment };
}

// POST /api/support/money/refunds/:id/complete { providerReference }
// Needs Payfast's refund reference: support can't mark money as returned without evidence (FR-21).
supportMoneyRouter.post("/refunds/:id/complete", async (req, res) => {
  const ref = typeof req.body?.providerReference === "string" ? req.body.providerReference.trim() : "";
  if (ref.length < 3 || ref.length > 100) {
    return res.status(422).json({
      error: "Enter the refund reference from Payfast as evidence.",
      fields: { providerReference: "Copy it from the Payfast dashboard." },
    });
  }
  await inTransaction(async (client) => {
    const found = await lockPendingRefund(client, req, res);
    if (!found) return;
    const { refund, payment } = found;
    await client.query(
      `UPDATE refunds SET status = 'succeeded', provider_reference = $2, completed_by = $3, completed_at = now() WHERE id = $1`,
      [refund.id, ref, req.user!.id]
    );
    // Fully refunded -> the payment's status says so. Partly refunded payments keep their status.
    const done = await client.query(
      "SELECT COALESCE(sum(amount_cents), 0)::int AS cents FROM refunds WHERE payment_id = $1 AND status = 'succeeded'",
      [payment.id]
    );
    if (done.rows[0].cents === payment.amount_cents) {
      await client.query("UPDATE payments SET status = 'refunded', updated_at = now() WHERE id = $1", [payment.id]);
    }
    await audit(client, {
      actorId: req.user!.id,
      action: "refund.complete",
      resourceType: "refund",
      resourceId: refund.id,
      outcome: "success",
      changes: { amountCents: refund.amount_cents, providerReference: ref },
    });
    res.json({ status: "succeeded" });
  });
});

// POST /api/support/money/refunds/:id/fail { reason } - frees the reserved amount so it can be tried again.
supportMoneyRouter.post("/refunds/:id/fail", async (req, res) => {
  const reason = reasonFrom(req, res);
  if (!reason) return;
  await inTransaction(async (client) => {
    const found = await lockPendingRefund(client, req, res);
    if (!found) return;
    await client.query(
      "UPDATE refunds SET status = 'failed', completed_by = $2, completed_at = now() WHERE id = $1",
      [found.refund.id, req.user!.id]
    );
    await audit(client, {
      actorId: req.user!.id,
      action: "refund.fail",
      resourceType: "refund",
      resourceId: found.refund.id,
      outcome: "success",
      reason,
    });
    res.json({ status: "failed" });
  });
});

// POST /api/support/money/refund-cases/:id/close { reason }
// Only when nothing is left hanging: no refund still pending, and every payment that was
// never applied to the order has been given back in full (spec BR-08).
supportMoneyRouter.post("/refund-cases/:id/close", async (req, res) => {
  const reason = reasonFrom(req, res);
  if (!reason) return;
  await inTransaction(async (client) => {
    const c = await lockOpenCase(client, req, res, "refund");
    if (!c) return;
    const payments = await paymentsWithBalances(client, Number(c.order_id));
    if (payments.some((p) => p.pendingCents > 0)) {
      return void res.status(409).json({ error: "A refund is still pending. Complete it or mark it failed first." });
    }
    if (payments.some((p) => p.status === "unapplied" && p.refundableCents > 0)) {
      return void res.status(409).json({ error: "Money that was never applied to the order must be refunded in full first." });
    }
    await closeCase(client, Number(c.id), "resolved", reason, req.user!.id);
    await audit(client, { actorId: req.user!.id, action: "case.close", resourceType: "support_case", resourceId: c.id, outcome: "success", reason });
    res.json({ status: "closed" });
  });
});

// ---------------------------------------------------------------------------
// Cash disputes (BR-11)
// ---------------------------------------------------------------------------

// POST /api/support/money/cash-cases/:id/settle { reason }
// The courier has handed over the missing cash (confirmed by support, e.g. with the seller).
// There is deliberately no "write off" action: a shortfall stays visible until it's resolved.
supportMoneyRouter.post("/cash-cases/:id/settle", async (req, res) => {
  const reason = reasonFrom(req, res);
  if (!reason) return;
  await inTransaction(async (client) => {
    const c = await lockOpenCase(client, req, res, "cash_dispute");
    if (!c) return;
    const k = await client.query(
      "SELECT id, collected_cents, remitted_cents, status FROM cash_receipts WHERE order_id = $1 FOR UPDATE",
      [c.order_id]
    );
    const receipt = k.rows[0];
    if (!receipt || receipt.status !== "disputed") {
      return void res.status(409).json({ error: "This cash isn't in dispute any more." });
    }
    await client.query(
      "UPDATE cash_receipts SET remitted_cents = collected_cents, status = 'remitted', remitted_at = now() WHERE id = $1",
      [receipt.id]
    );
    await closeCase(client, Number(c.id), "settled", reason, req.user!.id);
    await audit(client, {
      actorId: req.user!.id,
      action: "cash.settle",
      resourceType: "support_case",
      resourceId: c.id,
      outcome: "success",
      reason,
      changes: { orderId: Number(c.order_id), remittedCents: [receipt.remitted_cents, receipt.collected_cents] },
    });
    res.json({ status: "settled" });
  });
});

// ---------------------------------------------------------------------------
// Notes on any money case: what was checked, who was phoned. Stored in the audit log.
// ---------------------------------------------------------------------------

supportMoneyRouter.post("/cases/:id/notes", async (req, res) => {
  const note = reasonFrom(req, res);
  if (!note) return;
  const id = Number(req.params.id);
  const c = Number.isInteger(id)
    ? await pool.query("SELECT id, status FROM support_cases WHERE id = $1 AND case_type IN ('refund', 'cash_dispute')", [id])
    : { rows: [] as any[] };
  if (!c.rows[0]) return res.status(404).json({ error: "Case not found." });
  await audit(pool, { actorId: req.user!.id, action: "case.note", resourceType: "support_case", resourceId: id, outcome: "success", reason: note });
  res.status(201).json({ ok: true });
});
