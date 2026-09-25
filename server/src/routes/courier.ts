import { Request, Response, Router } from "express";
import { PoolClient } from "pg";
import { pool } from "../db";
import { requireRole } from "../auth/session";
import { checkHandoverCode } from "../lib/handover";
import { consumeReservation, recordStatusChange } from "../lib/stock";

// Courier flow (spec FR-14, FR-15, TX-03). Only approved couriers get here.
export const courierRouter = Router();
courierRouter.use(requireRole("courier"));

// GET /api/courier/jobs - open jobs anyone can claim.
// Minimum disclosure (BR-13): before claiming, a courier sees the seller's area, the fee
// and whether cash is involved - never the customer's name, address or phone.
courierRouter.get("/jobs", async (_req, res) => {
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
            d.claimed_at, d.collected_at, d.delivered_at,
            o.order_number, o.delivery_address, o.notes,
            u.display_name AS customer_name, u.phone AS customer_phone,
            b.name AS business_name, b.area AS business_area, b.pickup_address, b.phone AS business_phone,
            c.status AS cash_status,
            (SELECT json_agg(json_build_object('name', i.product_name, 'quantity', i.quantity) ORDER BY i.id)
               FROM order_items i WHERE i.order_id = o.id) AS items
       FROM deliveries d
       JOIN orders o ON o.id = d.order_id
       JOIN users u ON u.id = o.consumer_id
       JOIN businesses b ON b.id = o.business_id
       LEFT JOIN cash_receipts c ON c.order_id = o.id
      WHERE d.courier_id = $1
        AND (d.status IN ('claimed', 'collected') OR d.delivered_at > now() - interval '3 days')
      ORDER BY d.status = 'delivered', d.claimed_at DESC`,
    [req.user!.id]
  );
  res.json(
    r.rows.map((j) => {
      const active = j.status === "claimed" || j.status === "collected";
      return {
        id: Number(j.id),
        status: j.status,
        orderNumber: j.order_number,
        feeCents: j.fee_cents,
        cashToCollectCents: j.cash_to_collect_cents,
        cashStatus: j.cash_status,
        releasedBySeller: Boolean(j.released),
        business: {
          name: j.business_name,
          area: j.business_area,
          pickupAddress: active ? j.pickup_address : null,
          phone: active ? j.business_phone : null,
        },
        customer: active
          ? { name: j.customer_name, phone: j.customer_phone, address: j.delivery_address, notes: j.notes }
          : null,
        items: j.items ?? [],
        claimedAt: j.claimed_at,
        collectedAt: j.collected_at,
        deliveredAt: j.delivered_at,
      };
    })
  );
});

// POST /api/courier/jobs/:id/claim - first courier wins (spec TX-03 "compare-and-set").
// The WHERE status = 'open' is the whole trick: PostgreSQL updates the row for only one
// of two simultaneous requests; the other finds no open row and gets 409.
courierRouter.post("/jobs/:id/claim", async (req, res) => {
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
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
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

// GET /api/courier/cash - cash I've collected that a seller hasn't confirmed receiving yet.
courierRouter.get("/cash", async (req, res) => {
  const r = await pool.query(
    `SELECT COALESCE(sum(collected_cents - remitted_cents), 0)::int AS cents
       FROM cash_receipts WHERE collected_by = $1 AND status <> 'remitted'`,
    [req.user!.id]
  );
  res.json({ holdingCents: r.rows[0].cents });
});
