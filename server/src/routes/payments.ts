import crypto from "crypto";
import express, { Router } from "express";
import { pool } from "../db";
import { requireRole } from "../auth/session";
import {
  amountToCents,
  buildCheckout,
  confirmWithPayfast,
  isPayfastIp,
  itnSignature,
  parseFormInOrder,
  payfastConfig,
} from "../lib/payfast";
import { recordStatusChange } from "../lib/stock";
import { openOrderCase } from "../lib/cases";

export const paymentsRouter = Router();

// ---------------------------------------------------------------------------
// 1. Start (or resume) an online payment - spec API "POST /orders/{id}/payment-attempts"
// ---------------------------------------------------------------------------
paymentsRouter.post("/orders/:id/payment-attempts", requireRole("consumer", "entrepreneur", "courier"), async (req, res) => {
  const cfg = payfastConfig();
  if (!cfg) return res.status(503).json({ error: "Online payment isn't set up. Please contact the seller." });
  const orderId = Number(req.params.id);
  if (!Number.isInteger(orderId)) return res.status(404).json({ error: "Order not found." });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const o = await client.query(
      `SELECT id, order_number, consumer_id, status, total_cents, payment_due_at > now() AS in_time
         FROM orders WHERE id = $1 FOR UPDATE`,
      [orderId]
    );
    const order = o.rows[0];
    if (!order || Number(order.consumer_id) !== req.user!.id) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Order not found." });
    }
    // Seller first, payment second (BR-07): only an accepted, unpaid, in-time order can be paid.
    if (order.status !== "awaiting_payment" || !order.in_time) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "This order can't be paid now. Please refresh your orders." });
    }

    // An earlier attempt whose outcome we don't know yet is REUSED, not replaced, so the
    // customer can't accidentally be charged twice for one order (spec 5.2, 5.6).
    const existing = await client.query(
      "SELECT attempt_reference, amount_cents FROM payments WHERE order_id = $1 AND status = 'pending' ORDER BY id DESC LIMIT 1",
      [orderId]
    );
    let reference: string;
    if (existing.rowCount) {
      reference = existing.rows[0].attempt_reference;
    } else {
      const n = await client.query("SELECT count(*)::int AS n FROM payments WHERE order_id = $1", [orderId]);
      reference = `${order.order_number}-P${n.rows[0].n + 1}`;
      await client.query("INSERT INTO payments (order_id, attempt_reference, amount_cents) VALUES ($1, $2, $3)", [
        orderId,
        reference,
        order.total_cents,
      ]);
    }
    await client.query("COMMIT");

    res.json(
      buildCheckout(cfg, { reference, amountCents: order.total_cents, orderNumber: order.order_number, orderId })
    );
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
});

// ---------------------------------------------------------------------------
// 2. Payfast's ITN - the ONLY thing that can mark an order as paid (spec TX-02)
// ---------------------------------------------------------------------------

async function logEvent(e: {
  attemptReference?: string;
  providerReference?: string;
  paymentStatus?: string;
  amountCents?: number | null;
  outcome: string;
}) {
  await pool.query(
    `INSERT INTO payment_events (provider, attempt_reference, provider_reference, payment_status, amount_cents, outcome)
     VALUES ('payfast', $1, $2, $3, $4, $5)`,
    [e.attemptReference?.slice(0, 40) ?? null, e.providerReference?.slice(0, 100) ?? null, e.paymentStatus?.slice(0, 20) ?? null, e.amountCents ?? null, e.outcome]
  );
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

paymentsRouter.post(
  "/payments/payfast/notify",
  // Payfast posts a form, not JSON. We keep the raw text so the field order is preserved.
  express.text({ type: "application/x-www-form-urlencoded", limit: "20kb" }),
  async (req, res) => {
    const cfg = payfastConfig();
    if (!cfg) return res.status(503).end();

    const fields = parseFormInOrder(typeof req.body === "string" ? req.body : "");
    const data = Object.fromEntries(fields);
    const meta = {
      attemptReference: data.m_payment_id,
      providerReference: data.pf_payment_id,
      paymentStatus: data.payment_status,
      amountCents: amountToCents(data.amount_gross ?? ""),
    };
    const reject = async (outcome: string, status = 400) => {
      await logEvent({ ...meta, outcome });
      res.status(status).end();
    };

    // Check 1: the signature proves the data wasn't made up or changed on the way.
    if (!data.signature || !safeEqual(itnSignature(fields, cfg.passphrase), data.signature)) {
      return reject("rejected_signature");
    }
    // Check 2: it's for OUR merchant account.
    if (data.merchant_id !== cfg.merchantId) return reject("rejected_merchant");
    // Check 3: it really came from Payfast's servers.
    if (cfg.verifySourceIp && !(await isPayfastIp(req.ip ?? ""))) return reject("rejected_source_ip");
    // Check 4: it matches a payment attempt we created, for exactly the right amount.
    const a = await pool.query("SELECT id, order_id, amount_cents FROM payments WHERE attempt_reference = $1", [
      data.m_payment_id ?? "",
    ]);
    const attempt = a.rows[0];
    if (!attempt) return reject("rejected_unknown_reference");
    if (meta.amountCents !== attempt.amount_cents) return reject("rejected_amount");
    if (!data.pf_payment_id) return reject("rejected_missing_reference");
    // Check 5: ask Payfast directly whether this notification is genuine.
    if (cfg.verifyWithServer && !(await confirmWithPayfast(cfg, fields))) return reject("rejected_not_confirmed");

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // Lock the order first, then the attempt: the expiry job locks orders the same way,
      // so a payment and an expiry can't both win.
      const o = await client.query("SELECT id, status FROM orders WHERE id = $1 FOR UPDATE", [attempt.order_id]);
      const order = o.rows[0];
      await client.query("SELECT id FROM payments WHERE id = $1 FOR UPDATE", [attempt.id]);

      // The same notification again (Payfast retry, or a replay): harmless, change nothing.
      const seen = await client.query("SELECT id FROM payments WHERE provider_reference = $1", [data.pf_payment_id]);
      if (seen.rowCount) {
        await client.query("ROLLBACK");
        await logEvent({ ...meta, outcome: "duplicate_ignored" });
        return res.status(200).end();
      }

      if (data.payment_status !== "COMPLETE") {
        if (data.payment_status === "FAILED") {
          await client.query(
            "UPDATE payments SET status = 'failed', provider_reference = $2, updated_at = now() WHERE id = $1 AND status = 'pending'",
            [attempt.id, data.pf_payment_id]
          );
        }
        await client.query("COMMIT");
        await logEvent({ ...meta, outcome: `recorded_${String(data.payment_status).toLowerCase()}` });
        return res.status(200).end();
      }

      // Verified money. Apply it only if the order is still waiting for payment and
      // nothing else has been applied yet (BR-08: at most one applied capture per order).
      const alreadyPaid = await client.query("SELECT 1 FROM payments WHERE order_id = $1 AND status = 'paid'", [order.id]);
      const current = await client.query("SELECT status FROM payments WHERE id = $1", [attempt.id]);
      const canApply = order.status === "awaiting_payment" && alreadyPaid.rowCount === 0;

      if (current.rows[0].status === "pending") {
        await client.query(
          `UPDATE payments SET status = $2, provider_reference = $3, verified_at = now(), updated_at = now() WHERE id = $1`,
          [attempt.id, canApply ? "paid" : "unapplied", data.pf_payment_id]
        );
      } else {
        // A second genuine capture for the same attempt: keep it as its own record.
        await client.query(
          `INSERT INTO payments (order_id, attempt_reference, status, amount_cents, provider_reference, verified_at)
           VALUES ($1, $2, 'unapplied', $3, $4, now())`,
          [order.id, `${data.m_payment_id}-X${String(data.pf_payment_id).slice(-8)}`.slice(0, 40), attempt.amount_cents, data.pf_payment_id]
        );
      }

      if (canApply && current.rows[0].status === "pending") {
        await client.query("UPDATE orders SET status = 'confirmed', payment_due_at = NULL, updated_at = now() WHERE id = $1", [order.id]);
        await recordStatusChange(client, order.id, "awaiting_payment", "confirmed", null, "Online payment verified (Payfast)");
        await client.query("COMMIT");
        await logEvent({ ...meta, outcome: "applied" });
      } else {
        // Real money that can't be applied (order expired/cancelled, or already paid):
        // never resurrect the order, never ignore the money - it needs a refund (spec 5.6),
        // so a refund case for support is opened in the same transaction.
        const consumer = await client.query("SELECT consumer_id FROM orders WHERE id = $1", [order.id]);
        await openOrderCase(client, {
          type: "refund",
          orderId: order.id,
          requesterId: Number(consumer.rows[0].consumer_id),
          details: { why: alreadyPaid.rowCount ? "second_payment" : "late_payment" },
          actorId: null,
        });
        await client.query("COMMIT");
        await logEvent({ ...meta, outcome: "unapplied_needs_refund" });
      }
      res.status(200).end();
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
);
