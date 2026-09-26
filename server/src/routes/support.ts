import { Request, Response, Router } from "express";
import rateLimit from "express-rate-limit";
import { PoolClient } from "pg";
import { closeCase, inTransaction, reasonFrom } from "./supportShared";
import { enqueue } from "../lib/outbox";
import { pool } from "../db";
import { requireRole, requireStaff } from "../auth/session";
import { audit } from "../lib/audit";
import { decryptSecret, encryptSecret } from "../lib/secretBox";
import { newTotpSecret, otpauthUrl, verifyTotp } from "../lib/totp";

// Restricted support console (spec FR-21, UC-17, UI-13).
// Support is not a public role: the accounts are created in the database, never by sign-up.
// Every decision needs a written reason and is recorded in the append-only audit log.
export const supportRouter = Router();

// ---------------------------------------------------------------------------
// Second sign-in step: the code from an authenticator app
// ---------------------------------------------------------------------------

// GET /api/support/mfa - has this staff member set up their authenticator app yet?
supportRouter.get("/mfa", requireRole("support"), async (req, res) => {
  const r = await pool.query("SELECT totp_secret_enc IS NOT NULL AS enrolled FROM users WHERE id = $1", [req.user!.id]);
  res.json({ enrolled: r.rows[0].enrolled, verified: req.user!.mfaVerified });
});

// POST /api/support/mfa/setup - first time only: a new secret for the app to scan.
// It stays "pending" until a correct code proves the phone really has it.
// (A lost phone is reset by an administrator in the database - deliberately not self-service.)
supportRouter.post("/mfa/setup", requireRole("support"), async (req, res) => {
  const r = await pool.query("SELECT totp_secret_enc FROM users WHERE id = $1", [req.user!.id]);
  if (r.rows[0].totp_secret_enc) return res.status(409).json({ error: "Your authenticator app is already set up." });
  const secret = newTotpSecret();
  await pool.query("UPDATE users SET totp_pending_enc = $2 WHERE id = $1", [req.user!.id, encryptSecret(secret)]);
  res.json({ secret, otpauthUrl: otpauthUrl(secret, req.user!.displayName) });
});

// 5 tries per 5 minutes per staff member: 1 000 000 possible codes can't be guessed.
const mfaLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 5,
  keyGenerator: (req) => `staff-${req.user?.id}`,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many wrong codes. Wait 5 minutes and try again." },
});

// POST /api/support/mfa/verify { code } - marks THIS session as verified.
supportRouter.post("/mfa/verify", requireRole("support"), mfaLimiter, async (req, res) => {
  const code = typeof req.body?.code === "string" ? req.body.code.replace(/\s/g, "") : "";
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Locked, so two requests can't both use the same code (the last-step check below).
    const r = await client.query(
      "SELECT totp_secret_enc, totp_pending_enc, totp_last_step FROM users WHERE id = $1 FOR UPDATE",
      [req.user!.id]
    );
    const u = r.rows[0];
    const enrolling = !u.totp_secret_enc;
    const stored = u.totp_secret_enc ?? u.totp_pending_enc;
    if (!stored) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Set up your authenticator app first." });
    }
    const lastStep = u.totp_last_step === null ? null : Number(u.totp_last_step);
    const step = verifyTotp(decryptSecret(stored), code, lastStep);
    if (step === null) {
      await audit(client, { actorId: req.user!.id, action: "mfa.verify", resourceType: "user", resourceId: req.user!.id, outcome: "failed" });
      await client.query("COMMIT");
      return res.status(401).json({ error: "That code isn't right. Use the newest code in your app." });
    }
    await client.query(
      `UPDATE users SET totp_last_step = $2,
              totp_secret_enc = COALESCE(totp_secret_enc, totp_pending_enc), totp_pending_enc = NULL
        WHERE id = $1`,
      [req.user!.id, step]
    );
    await client.query("UPDATE sessions SET mfa_verified_at = now() WHERE token_hash = $1", [req.sessionTokenHash]);
    await audit(client, {
      actorId: req.user!.id,
      action: enrolling ? "mfa.enrol" : "mfa.verify",
      resourceType: "user",
      resourceId: req.user!.id,
      outcome: "success",
    });
    await client.query("COMMIT");
    res.json({ verified: true });
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
});

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

// GET /api/support/overview - how many open items in each queue this person may see.
supportRouter.get("/overview", requireStaff(), async (req, res) => {
  const r = await pool.query(
    `SELECT count(*) FILTER (WHERE case_type IN ('seller_application', 'courier_application'))::int AS applications,
            count(*) FILTER (WHERE case_type IN ('refund', 'cash_dispute'))::int AS money,
            count(*) FILTER (WHERE case_type IN ('fulfilment', 'order_problem'))::int AS operations,
            count(*) FILTER (WHERE case_type IN ('privacy_correction', 'privacy_deletion'))::int AS privacy
       FROM support_cases WHERE status = 'open'`
  );
  res.json({ scopes: req.user!.staffScopes, counts: r.rows[0] });
});

// ---------------------------------------------------------------------------
// Seller and courier applications (spec FR-02, UC-02, TC-02) - scope "approvals"
// ---------------------------------------------------------------------------

supportRouter.get("/applications", requireStaff("approvals"), async (_req, res) => {
  // Open ones first, then the 20 most recent decisions for reference.
  const r = await pool.query(
    `(SELECT c.*, u.display_name, u.phone, r.display_name AS resolved_by_name
        FROM support_cases c JOIN users u ON u.id = c.requester_id LEFT JOIN users r ON r.id = c.resolved_by
       WHERE c.status = 'open' AND c.case_type IN ('seller_application', 'courier_application')
       ORDER BY c.created_at)
     UNION ALL
     (SELECT c.*, u.display_name, u.phone, r.display_name AS resolved_by_name
        FROM support_cases c JOIN users u ON u.id = c.requester_id LEFT JOIN users r ON r.id = c.resolved_by
       WHERE c.status = 'closed' AND c.case_type IN ('seller_application', 'courier_application')
       ORDER BY c.closed_at DESC LIMIT 20)`
  );
  res.json(
    r.rows.map((c) => ({
      id: Number(c.id),
      type: c.case_type === "seller_application" ? "seller" : "courier",
      status: c.status,
      applicant: { name: c.display_name, phone: c.phone },
      details: c.details,
      resolution: c.resolution,
      reason: c.resolution_reason,
      resolvedBy: c.resolved_by_name,
      createdAt: c.created_at,
      closedAt: c.closed_at,
    }))
  );
});

// Loads an OPEN application with it and its applicant locked, or answers 404/409 itself.
async function lockOpenApplication(client: PoolClient, req: Request, res: Response) {
  const id = Number(req.params.id);
  const c = Number.isInteger(id)
    ? await client.query(
        `SELECT * FROM support_cases WHERE id = $1 AND case_type IN ('seller_application', 'courier_application') FOR UPDATE`,
        [id]
      )
    : { rows: [] as any[] };
  const app = c.rows[0];
  if (!app) {
    res.status(404).json({ error: "Application not found." });
    return null;
  }
  if (app.status !== "open") {
    res.status(409).json({ error: "Someone has already decided this application. Refresh the list." });
    return null;
  }
  const u = await client.query("SELECT id, role FROM users WHERE id = $1 FOR UPDATE", [app.requester_id]);
  return { app, applicant: u.rows[0] };
}

// POST /api/support/applications/:id/approve { reason }
// One transaction: the new role, the business or courier profile, the closed case and the
// audit row are saved together - or none of them are.
supportRouter.post("/applications/:id/approve", requireStaff("approvals"), async (req, res) => {
  const reason = reasonFrom(req, res);
  if (!reason) return;
  await inTransaction(async (client) => {
    const found = await lockOpenApplication(client, req, res);
    if (!found) return;
    const { app, applicant } = found;
    if (applicant.role !== "consumer") {
      return void res.status(409).json({ error: "This person already has a seller or courier account." });
    }

    const d = app.details;
    let changes: Record<string, unknown>;
    if (app.case_type === "seller_application") {
      const b = await client.query(
        `INSERT INTO businesses (owner_id, name, description, area, pickup_address, phone, approved_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [applicant.id, d.businessName, d.description || null, d.area, d.pickupAddress, d.phone, req.user!.id]
      );
      await client.query("UPDATE users SET role = 'entrepreneur', updated_at = now() WHERE id = $1", [applicant.id]);
      changes = { role: ["consumer", "entrepreneur"], businessId: Number(b.rows[0].id) };
    } else {
      await client.query(
        "INSERT INTO courier_profiles (user_id, vehicle_type, area, approved_by) VALUES ($1, $2, $3, $4)",
        [applicant.id, d.vehicleType, d.area, req.user!.id]
      );
      await client.query("UPDATE users SET role = 'courier', updated_at = now() WHERE id = $1", [applicant.id]);
      changes = { role: ["consumer", "courier"] };
    }
    await closeCase(client, Number(app.id), "approved", reason, req.user!.id);
    await enqueue(client, {
      type: "application.decided",
      aggregateId: Number(app.id),
      dedupeKey: `application:${app.id}`,
      payload: { userId: Number(applicant.id), approved: true, kind: app.case_type === "seller_application" ? "seller" : "courier" },
    });
    await audit(client, {
      actorId: req.user!.id,
      action: "application.approve",
      resourceType: "support_case",
      resourceId: app.id,
      outcome: "success",
      reason,
      changes,
    });
    res.json({ status: "approved" });
  });
});

// POST /api/support/applications/:id/reject { reason } - the applicant sees the reason.
supportRouter.post("/applications/:id/reject", requireStaff("approvals"), async (req, res) => {
  const reason = reasonFrom(req, res);
  if (!reason) return;
  await inTransaction(async (client) => {
    const found = await lockOpenApplication(client, req, res);
    if (!found) return;
    await closeCase(client, Number(found.app.id), "rejected", reason, req.user!.id);
    await enqueue(client, {
      type: "application.decided",
      aggregateId: Number(found.app.id),
      dedupeKey: `application:${found.app.id}`,
      payload: { userId: Number(found.app.requester_id), approved: false, kind: found.app.case_type === "seller_application" ? "seller" : "courier", reason },
    });
    await audit(client, {
      actorId: req.user!.id,
      action: "application.reject",
      resourceType: "support_case",
      resourceId: found.app.id,
      outcome: "success",
      reason,
    });
    res.json({ status: "rejected" });
  });
});

// ---------------------------------------------------------------------------
// Suspending and reinstating sellers and couriers - scope "approvals"
// A suspended shop disappears from the catalogue and can't list products; a suspended
// courier can't take new jobs. Work already in progress can still be finished, so no
// customer is left stranded.
// ---------------------------------------------------------------------------

supportRouter.get("/accounts", requireStaff("approvals"), async (_req, res) => {
  const [b, c] = await Promise.all([
    pool.query(
      `SELECT b.id, b.name, b.area, b.is_active, u.display_name AS owner_name
         FROM businesses b JOIN users u ON u.id = b.owner_id ORDER BY b.name`
    ),
    pool.query(
      `SELECT p.user_id, p.vehicle_type, p.area, p.is_active, u.display_name
         FROM courier_profiles p JOIN users u ON u.id = p.user_id ORDER BY u.display_name`
    ),
  ]);
  res.json({
    businesses: b.rows.map((x) => ({ id: Number(x.id), name: x.name, area: x.area, active: x.is_active, ownerName: x.owner_name })),
    couriers: c.rows.map((x) => ({ userId: Number(x.user_id), name: x.display_name, area: x.area, vehicleType: x.vehicle_type, active: x.is_active })),
  });
});

// One handler for all four actions. The WHERE is_active = <expected> makes a repeated or
// out-of-date click a harmless 409 instead of a second, misleading audit entry.
function setActive(kind: "business" | "courier", active: boolean) {
  const table = kind === "business" ? "businesses" : "courier_profiles";
  const idColumn = kind === "business" ? "id" : "user_id";
  return async (req: Request, res: Response) => {
    const reason = reasonFrom(req, res);
    if (!reason) return;
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(404).json({ error: "Not found." });
    await inTransaction(async (client) => {
      const r = await client.query(
        `UPDATE ${table} SET is_active = $2 WHERE ${idColumn} = $1 AND is_active = $3 RETURNING ${idColumn}`,
        [id, active, !active]
      );
      if (r.rowCount === 0) {
        return void res.status(409).json({ error: active ? "This account isn't suspended." : "This account is already suspended." });
      }
      await audit(client, {
        actorId: req.user!.id,
        action: `${kind}.${active ? "reinstate" : "suspend"}`,
        resourceType: kind,
        resourceId: id,
        outcome: "success",
        reason,
      });
      res.json({ active });
    });
  };
}

supportRouter.post("/businesses/:id/suspend", requireStaff("approvals"), setActive("business", false));
supportRouter.post("/businesses/:id/reinstate", requireStaff("approvals"), setActive("business", true));
supportRouter.post("/couriers/:id/suspend", requireStaff("approvals"), setActive("courier", false));
supportRouter.post("/couriers/:id/reinstate", requireStaff("approvals"), setActive("courier", true));

// ---------------------------------------------------------------------------
// Audit log search - scope "audit". Read-only: there is no route that edits it, and the
// database trigger would refuse anyway.
// ---------------------------------------------------------------------------

supportRouter.get("/audit", requireStaff("audit"), async (req, res) => {
  const q = (k: string) => (typeof req.query[k] === "string" && req.query[k] ? String(req.query[k]) : null);
  const r = await pool.query(
    `SELECT a.id, a.action, a.resource_type, a.resource_id, a.outcome, a.reason, a.changes, a.occurred_at,
            u.display_name AS actor_name
       FROM audit_events a LEFT JOIN users u ON u.id = a.actor_user_id
      WHERE ($1::text IS NULL OR a.action LIKE $1 || '%')
        AND ($2::text IS NULL OR a.resource_type = $2)
        AND ($3::text IS NULL OR a.resource_id = $3)
      ORDER BY a.id DESC
      LIMIT 100`,
    [q("action"), q("resourceType"), q("resourceId")]
  );
  res.json(
    r.rows.map((a) => ({
      id: Number(a.id),
      action: a.action,
      resourceType: a.resource_type,
      resourceId: a.resource_id,
      outcome: a.outcome,
      reason: a.reason,
      changes: a.changes,
      actorName: a.actor_name,
      occurredAt: a.occurred_at,
    }))
  );
});
