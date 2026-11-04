import { NextFunction, Request, Response, Router } from "express";
import { PoolClient } from "pg";
import { pool } from "../db";
import { requireRole } from "../auth/session";
import { checkHandoverCode } from "../lib/handover";
import { consumeReservation, recordStatusChange } from "../lib/stock";
import { holdResponse } from "../lib/holdResponse";
import { openOrderCase } from "../lib/cases";
import { POLICY } from "../lib/policy";
import { audit } from "../lib/audit";
import { DOCUMENT_LABEL, readDocument, saveDocument } from "./applications";
import { emailAdmin } from "../lib/email";
import { noteOnCase } from "../lib/caseMail";
import { canonicalSiteUrl } from "../lib/seo";
import { addressInKuruman, directionsUrl } from "../lib/geo";

// Courier flow (spec FR-14, FR-15, TX-03). Only approved couriers get here.
export const courierRouter = Router();
courierRouter.use(requireRole("courier"));

// Spec UC-02: a suspended courier "cannot claim jobs". Jobs they already hold can still be
// finished, so the customer still gets their order.
async function requireActiveCourier(req: Request, res: Response, next: NextFunction) {
  const r = await pool.query(
    `SELECT is_active,
            documents_due < current_date AND cardinality(COALESCE(documents_outstanding, '{}')) > 0 AS documents_overdue
       FROM courier_profiles WHERE user_id = $1`,
    [req.user!.id]
  );
  if (!r.rows[0]?.is_active) {
    return res.status(403).json({ error: "Your courier access is suspended, so you can't take new jobs. Contact support." });
  }
  // Documents still missing after their due date: no NEW jobs until support has checked them (jobs already
  // taken can still be finished).
  if (r.rows[0].documents_overdue) {
    return res.status(403).json({
      error: "Your documents are overdue, so you can't take new jobs. Upload them above; you can deliver again once support has checked them.",
      code: "documents",
    });
  }
  next();
}

// GET /api/courier/documents - which documents I still have to send, by when, and what's waiting for support.
courierRouter.get("/documents", async (req, res) => {
  const p = await pool.query(
    `SELECT COALESCE(documents_outstanding, '{}') AS outstanding, to_char(documents_due, 'YYYY-MM-DD') AS due,
            COALESCE(documents_due < current_date, false) AS overdue
       FROM courier_profiles WHERE user_id = $1`,
    [req.user!.id]
  );
  const open = await pool.query(
    `SELECT d.kind FROM support_cases c JOIN verification_documents d ON d.case_id = c.id
      WHERE c.requester_id = $1 AND c.case_type = 'courier_documents' AND c.status = 'open'`,
    [req.user!.id]
  );
  const last = await pool.query(
    `SELECT resolution, resolution_reason FROM support_cases
      WHERE requester_id = $1 AND case_type = 'courier_documents' AND status = 'closed' ORDER BY closed_at DESC LIMIT 1`,
    [req.user!.id]
  );
  res.json({
    outstanding: p.rows[0]?.outstanding ?? [],
    due: p.rows[0]?.due ?? null,
    overdue: p.rows[0]?.overdue ?? false, // the same rule that stops new jobs
    waitingForSupport: open.rows.map((r) => r.kind),
    lastRejectedReason: last.rows[0]?.resolution === "rejected" ? last.rows[0].resolution_reason : null,
  });
});

// POST /api/courier/documents/:kind { file } - send one of my outstanding documents. They go together in
// one case for support to check (encrypted, like an application's), and the admin is told by email.
courierRouter.post("/documents/:kind", async (req, res) => {
  const kind = String(req.params.kind);
  const p = await pool.query("SELECT vehicle_type, COALESCE(documents_outstanding, '{}') AS outstanding FROM courier_profiles WHERE user_id = $1", [req.user!.id]);
  if (!p.rows[0]?.outstanding.includes(kind)) return res.status(404).json({ error: "We don't need this document from you." });
  const d = readDocument(req.body?.file, DOCUMENT_LABEL[kind]);
  if ("problem" in d) return res.status(422).json({ error: d.problem, fields: { file: d.problem } });
  let caseId: number;
  let isNew = false;
  const open = await pool.query(
    "SELECT id FROM support_cases WHERE requester_id = $1 AND case_type = 'courier_documents' AND status = 'open'",
    [req.user!.id]
  );
  if (open.rowCount) caseId = Number(open.rows[0].id);
  else {
    const c = await pool.query(
      `INSERT INTO support_cases (case_type, requester_id, details) VALUES ('courier_documents', $1, $2)
       ON CONFLICT DO NOTHING RETURNING id`,
      [req.user!.id, { vehicleType: p.rows[0].vehicle_type }]
    );
    if (c.rowCount === 0) return res.status(409).json({ error: "Please try again." });
    caseId = Number(c.rows[0].id);
    isNew = true;
  }
  await saveDocument(pool, caseId, req.user!.id, kind, d);
  await noteOnCase(caseId, `The courier sent their ${DOCUMENT_LABEL[kind]}.`, req.user!.id);
  await audit(pool, { actorId: req.user!.id, action: "courier.documents_send", resourceType: "support_case", resourceId: caseId, outcome: "success", changes: { kind } });
  res.status(201).json({ ok: true });
  if (isNew) {
    await emailAdmin(
      "Courier documents to check",
      `${req.user!.displayName.split(" ")[0]} (courier) sent documents to check.\n\nCheck them in the support console (Applications): ${canonicalSiteUrl()}/support\n\nFor privacy, the documents are not in this email.`
    );
  }
});

// GET /api/courier/jobs - open jobs anyone can claim.
// Minimum disclosure (BR-13): before claiming, a courier sees the seller's area, the fee
// and whether cash is involved - never the customer's name, address or phone.
courierRouter.get("/jobs", requireActiveCourier, async (_req, res) => {
  const r = await pool.query(
    `SELECT d.id, d.fee_cents, d.cash_to_collect_cents, d.created_at,
            b.name AS business_name, b.area AS business_area,
            (SELECT sum(i.quantity)::int FROM order_items i WHERE i.order_id = o.id) AS item_count
       FROM deliveries d
       JOIN orders o ON o.id = d.order_id
       JOIN businesses b ON b.id = o.business_id
      WHERE d.status = 'open' AND o.status = 'ready'
      ORDER BY d.created_at`
  );
  res.json(
    r.rows.map((j) => ({
      id: Number(j.id),
      feeCents: j.fee_cents,
      cashToCollectCents: j.cash_to_collect_cents,
      businessName: j.business_name,
      businessArea: j.business_area,
      itemCount: j.item_count,
      createdAt: j.created_at,
    }))
  );
});

// GET /api/courier/my-jobs - jobs assigned to me. Only now are the recipient details shown,
// and only while the job is active (spec FR-14: "only its assigned courier receives the
// minimum recipient details"). Finished jobs keep just the amounts.
courierRouter.get("/my-jobs", async (req, res) => {
  const r = await pool.query(
    `SELECT d.id, d.status, d.fee_cents, d.cash_to_collect_cents, d.released_to_courier_id = $1 AS released,
            d.claimed_at, d.collected_at, d.delivered_at, d.failed_reason, d.returned_at, o.status AS order_status,
            o.id AS order_id, o.order_number, o.delivery_address, o.notes, o.delivery_lat, o.delivery_lng,
            u.display_name AS customer_name, u.phone AS customer_phone, cp.vehicle_type,
            b.name AS business_name, b.area AS business_area, b.pickup_address, b.phone AS business_phone,
            c.status AS cash_status,
            (SELECT json_agg(json_build_object('name', i.product_name, 'quantity', i.quantity) ORDER BY i.id)
               FROM order_items i WHERE i.order_id = o.id) AS items
       FROM deliveries d
       JOIN orders o ON o.id = d.order_id
       JOIN users u ON u.id = o.consumer_id
       JOIN businesses b ON b.id = o.business_id
       LEFT JOIN cash_receipts c ON c.order_id = o.id
       LEFT JOIN courier_profiles cp ON cp.user_id = d.courier_id
      WHERE d.courier_id = $1
        AND (d.status IN ('claimed', 'collected')
             OR d.delivered_at > now() - interval '3 days'
             OR (d.status = 'failed' AND d.returned_at IS NULL))   -- goods still to take back
      ORDER BY d.status = 'delivered', d.claimed_at DESC`,
    [req.user!.id]
  );
  res.json(
    r.rows.map((j) => {
      const active = j.status === "claimed" || j.status === "collected";
      // After a failed delivery the courier needs the seller's address to bring the goods back -
      // but no longer the customer's details.
      const returning = j.status === "failed" && !j.returned_at;
      const pin = j.delivery_lat === null ? null : { lat: j.delivery_lat, lng: j.delivery_lng };
      return {
        id: Number(j.id),
        orderId: Number(j.order_id),
        status: j.status,
        orderNumber: j.order_number,
        feeCents: j.fee_cents,
        cashToCollectCents: j.cash_to_collect_cents,
        cashStatus: j.cash_status,
        releasedBySeller: Boolean(j.released),
        business: {
          name: j.business_name,
          area: j.business_area,
          pickupAddress: active || returning ? j.pickup_address : null,
          phone: active || returning ? j.business_phone : null,
          // Shops have no map pin yet, so directions go to the written pickup address.
          directionsUrl: active || returning ? directionsUrl(addressInKuruman(j.pickup_address, j.business_area), j.vehicle_type) : null,
        },
        customer: active
          ? {
              name: j.customer_name,
              phone: j.customer_phone,
              address: j.delivery_address,
              notes: j.notes,
              location: pin,
              directionsUrl: directionsUrl(pin ?? addressInKuruman(j.delivery_address), j.vehicle_type),
            }
          : null,
        items: j.items ?? [],
        claimedAt: j.claimed_at,
        collectedAt: j.collected_at,
        deliveredAt: j.delivered_at,
        failedReason: j.failed_reason,
        orderStatus: j.order_status, // delivery_failed = support deciding; cancelled = bring the goods back
      };
    })
  );
});

// POST /api/courier/jobs/:id/claim - first courier wins (spec TX-03 "compare-and-set").
// The WHERE status = 'open' is the whole trick: PostgreSQL updates the row for only one
// of two simultaneous requests; the other finds no open row and gets 409.
courierRouter.post("/jobs/:id/claim", requireActiveCourier, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(404).json({ error: "Job not found." });

  const r = await pool.query(
    `UPDATE deliveries SET courier_id = $2, status = 'claimed', claimed_at = now()
      WHERE id = $1 AND status = 'open'
      RETURNING id`,
    [id, req.user!.id]
  );
  if (r.rowCount === 0) return res.status(409).json({ error: "Another courier already took this job." });
  res.json({ status: "claimed" });
});

// Runs `work` in a transaction with my delivery and its order locked.
async function withMyJob(req: Request, res: Response, work: (client: PoolClient, job: any) => Promise<void>) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(404).json({ error: "Job not found." });
    return;
  }
  const client = await pool.connect();
  const answer = holdResponse(res); // sent after COMMIT, not before
  try {
    await client.query("BEGIN");
    const d = await client.query("SELECT id, order_id, status, courier_id, released_to_courier_id FROM deliveries WHERE id = $1 FOR UPDATE", [id]);
    const job = d.rows[0];
    if (!job || Number(job.courier_id) !== req.user!.id) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "Job not found." });
      return;
    }
    const o = await client.query(
      `SELECT id, status, payment_method, total_cents, handover_code_hash,
              handover_code_expires_at <= now() AS code_expired, handover_failed_attempts
         FROM orders WHERE id = $1 FOR UPDATE`,
      [job.order_id]
    );
    job.order = { ...o.rows[0], id: Number(o.rows[0].id) };
    job.id = id;
    await work(client, job);
    await client.query("COMMIT");
  } catch (err) {
    answer.drop();
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
    answer.release();
  }
}

// POST /api/courier/jobs/:id/collect - picked up from the seller.
// Needs the seller's "handed over" confirmation for THIS courier (spec FR-15).
// The reserved stock is used up here, exactly once (spec FR-06).
courierRouter.post("/jobs/:id/collect", (req, res) =>
  withMyJob(req, res, async (client, job) => {
    if (job.status !== "claimed" || job.order.status !== "ready") {
      await client.query("ROLLBACK");
      res.status(409).json({ error: "This job has already been collected." });
      return;
    }
    if (Number(job.released_to_courier_id) !== req.user!.id) {
      await client.query("ROLLBACK");
      res.status(409).json({ error: "The seller hasn't confirmed handing the order to you yet. Ask them to tap “Hand over”." });
      return;
    }
    await consumeReservation(client, job.order.id);
    await client.query("UPDATE deliveries SET status = 'collected', collected_at = now() WHERE id = $1", [job.id]);
    await client.query("UPDATE orders SET status = 'out_for_delivery', updated_at = now() WHERE id = $1", [job.order.id]);
    await recordStatusChange(client, job.order.id, "ready", "out_for_delivery", req.user!.id, "Collected by courier");
    res.json({ status: "collected" });
  })
);

// POST /api/courier/jobs/:id/deliver - handed to the customer, proven by their one-time code.
// For a cash order the courier now holds the money: a cash receipt is recorded as "collected",
// and the seller confirms receiving it separately (spec BR-11).
courierRouter.post("/jobs/:id/deliver", (req, res) =>
  withMyJob(req, res, async (client, job) => {
    if (job.status !== "collected" || job.order.status !== "out_for_delivery") {
      await client.query("ROLLBACK");
      res.status(409).json({ error: job.status === "delivered" ? "This job is already delivered." : "Collect the order from the seller first." });
      return;
    }
    const check = await checkHandoverCode(client, job.order, req.body?.code);
    if (!check.ok) {
      await client.query(check.countedAttempt ? "COMMIT" : "ROLLBACK");
      res.status(check.status).json(check.body);
      return;
    }
    await client.query("UPDATE deliveries SET status = 'delivered', delivered_at = now() WHERE id = $1", [job.id]);
    await client.query(
      `UPDATE orders SET status = 'completed', handover_code_hash = NULL, handover_code_expires_at = NULL,
              updated_at = now() WHERE id = $1`,
      [job.order.id]
    );
    if (job.order.payment_method === "cash") {
      await client.query(
        "INSERT INTO cash_receipts (order_id, collected_by, collected_cents) VALUES ($1, $2, $3)",
        [job.order.id, req.user!.id, job.order.total_cents]
      );
    }
    await recordStatusChange(client, job.order.id, "out_for_delivery", "completed", req.user!.id, "Delivered by courier");
    res.json({ status: "delivered" });
  })
);

// Plain words for the customer's order history.
const FAIL_TEXT: Record<string, string> = {
  customer_absent: "Nobody was there to receive the order",
  wrong_address: "The courier couldn't find the address",
  customer_refused: "The order was refused at the door",
  no_payment: "The cash payment couldn't be collected",
};

// POST /api/courier/jobs/:id/fail { reason } - the order couldn't be handed over (spec FR-15).
// It is NOT completed: the courier keeps the goods, the customer's code stops working, and
// support decides whether to try again or cancel (and refund if paid).
courierRouter.post("/jobs/:id/fail", (req, res) =>
  withMyJob(req, res, async (client, job) => {
    const reason = req.body?.reason;
    if (!POLICY.deliveryFailReasons.includes(reason)) {
      await client.query("ROLLBACK");
      res.status(422).json({ error: "Choose why the delivery didn't work." });
      return;
    }
    if (job.status !== "collected" || job.order.status !== "out_for_delivery") {
      await client.query("ROLLBACK");
      res.status(409).json({ error: "Only an order you're delivering can be marked as not delivered." });
      return;
    }
    await client.query("UPDATE deliveries SET status = 'failed', failed_reason = $2, failed_at = now() WHERE id = $1", [job.id, reason]);
    await client.query(
      `UPDATE orders SET status = 'delivery_failed', handover_code_hash = NULL, handover_code_expires_at = NULL,
              updated_at = now() WHERE id = $1`,
      [job.order.id]
    );
    await recordStatusChange(client, job.order.id, "out_for_delivery", "delivery_failed", req.user!.id, FAIL_TEXT[reason]);
    const o = await client.query("SELECT consumer_id FROM orders WHERE id = $1", [job.order.id]);
    await openOrderCase(client, {
      type: "fulfilment",
      orderId: job.order.id,
      requesterId: Number(o.rows[0].consumer_id),
      details: { why: "delivery_failed", reason },
      actorId: req.user!.id,
    });
    res.json({ status: "failed" });
  })
);

// GET /api/courier/cash - cash I've collected that a seller hasn't confirmed receiving yet.
courierRouter.get("/cash", async (req, res) => {
  const r = await pool.query(
    `SELECT COALESCE(sum(collected_cents - remitted_cents), 0)::int AS cents
       FROM cash_receipts WHERE collected_by = $1 AND status <> 'remitted'`,
    [req.user!.id]
  );
  res.json({ holdingCents: r.rows[0].cents });
});
