import { Router } from "express";
import { pool } from "../db";
import { requireAuth, requireRole } from "../auth/session";
import { audit } from "../lib/audit";
import { normaliseSaPhone } from "../lib/phone";
import { POLICY } from "../lib/policy";

// Applying to sell or deliver (spec FR-02, UC-02). Everyone registers as a customer; this
// only creates a case for support to review. Nothing here changes anyone's role - only an
// approved support decision does (routes/support.ts).
export const applicationsRouter = Router();

// GET /api/applications/mine - my latest application and what happened to it.
applicationsRouter.get("/mine", requireAuth, async (req, res) => {
  const r = await pool.query(
    `SELECT id, case_type, status, resolution, resolution_reason, details, created_at, closed_at
       FROM support_cases
      WHERE requester_id = $1 AND case_type IN ('seller_application', 'courier_application')
      ORDER BY id DESC LIMIT 1`,
    [req.user!.id]
  );
  const a = r.rows[0];
  res.json({
    application: a
      ? {
          id: Number(a.id),
          type: a.case_type === "seller_application" ? "seller" : "courier",
          status: a.status,
          resolution: a.resolution,
          reason: a.resolution_reason,
          details: a.details,
          createdAt: a.created_at,
          closedAt: a.closed_at,
        }
      : null,
  });
});

const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");

// POST /api/applications - only a plain customer account can apply (one role per account in this MVP).
applicationsRouter.post("/", requireRole("consumer"), async (req, res) => {
  const body = req.body ?? {};
  const fields: Record<string, string> = {};
  let caseType: string;
  let details: Record<string, string>;

  if (body.type === "seller") {
    caseType = "seller_application";
    const phone = normaliseSaPhone(text(body.phone));
    details = {
      businessName: text(body.businessName),
      description: text(body.description),
      area: text(body.area),
      pickupAddress: text(body.pickupAddress),
      phone: phone ?? "",
    };
    if (details.businessName.length < 2 || details.businessName.length > 100) fields.businessName = "Enter the business name (2 to 100 characters).";
    if (details.description.length > 500) fields.description = "Keep the description under 500 characters.";
    if (!POLICY.serviceAreas.includes(details.area)) fields.area = "Choose your area from the list.";
    if (details.pickupAddress.length < 5 || details.pickupAddress.length > 200) fields.pickupAddress = "Enter where customers collect orders.";
    if (!phone) fields.phone = "Enter a South African phone number for the business.";
  } else if (body.type === "courier") {
    caseType = "courier_application";
    details = { vehicleType: text(body.vehicleType), area: text(body.area) };
    if (!POLICY.vehicleTypes.includes(details.vehicleType)) fields.vehicleType = "Choose how you'll deliver.";
    if (!POLICY.serviceAreas.includes(details.area)) fields.area = "Choose your area from the list.";
  } else {
    return res.status(422).json({ error: "Choose whether you want to sell or deliver." });
  }

  if (Object.keys(fields).length > 0) {
    return res.status(422).json({ error: "Please check the highlighted fields.", fields });
  }

  // The partial unique index one_open_application_per_user makes a second waiting
  // application impossible even if two requests arrive together.
  const r = await pool.query(
    `INSERT INTO support_cases (case_type, requester_id, details)
     VALUES ($1, $2, $3)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [caseType, req.user!.id, details]
  );
  if (r.rowCount === 0) {
    return res.status(409).json({ error: "You already have an application waiting for review." });
  }
  await audit(pool, {
    actorId: req.user!.id,
    action: "application.submit",
    resourceType: "support_case",
    resourceId: r.rows[0].id,
    outcome: "success",
    changes: { type: caseType },
  });
  res.status(201).json({ id: Number(r.rows[0].id) });
});
