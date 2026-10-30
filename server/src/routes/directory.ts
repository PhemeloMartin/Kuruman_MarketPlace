import { Router } from "express";
import { pool } from "../db";
import { requireAuth, requireStaff } from "../auth/session";
import { audit } from "../lib/audit";
import { normaliseSaPhone } from "../lib/phone";
import { POLICY } from "../lib/policy";
import { cleanText } from "../lib/reviews";
import { inTransaction, reasonFrom } from "./supportShared";

// Kuruman Business Directory (Tier 2): local services people phone directly - plumbers, hairdressers,
// mechanics, tailors... Free to list. The person listing confirms they may publish the phone number
// (POPIA: consent for personal information), and support approves every listing before it shows.
export const directoryRouter = Router();

export const DIRECTORY_CATEGORIES: Record<string, string> = {
  plumbing: "Plumbing",
  electrical: "Electrical",
  building: "Building & repairs",
  mechanic: "Car repairs",
  hair_beauty: "Hair & beauty",
  sewing: "Tailoring & sewing",
  transport: "Transport & moving",
  lessons: "Lessons & tutoring",
  cleaning: "Cleaning",
  events: "Catering & events",
  repairs: "Phone & computer repairs",
  other: "Other services",
};

function toListing(r: any) {
  return {
    id: Number(r.id),
    name: r.name,
    category: r.category,
    categoryName: DIRECTORY_CATEGORIES[r.category] ?? r.category,
    description: r.description,
    area: r.area,
    phone: r.phone,
    hasWhatsapp: r.has_whatsapp,
    hours: r.hours,
  };
}

// GET /api/directory?category=plumbing&q=geyser - approved listings only.
directoryRouter.get("/directory", async (req, res) => {
  const category = typeof req.query.category === "string" && DIRECTORY_CATEGORIES[req.query.category] ? req.query.category : null;
  const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 60).toLowerCase() : "";
  const pattern = q ? `%${q.replace(/[\\%_]/g, "\\$&")}%` : null;
  const r = await pool.query(
    `SELECT * FROM directory_listings
      WHERE status = 'approved' AND ($1::text IS NULL OR category = $1)
        AND ($2::text IS NULL OR lower(name) LIKE $2 OR lower(coalesce(description, '')) LIKE $2 OR lower(area) LIKE $2)
      ORDER BY name`,
    [category, pattern]
  );
  res.json({ categories: DIRECTORY_CATEGORIES, listings: r.rows.map(toListing) });
});

// POST /api/directory - suggest a listing (signed in, so support knows who to ask about it).
directoryRouter.post("/directory", requireAuth, async (req, res) => {
  const b = req.body ?? {};
  const fields: Record<string, string> = {};
  const name = cleanText(b.name, 100);
  const description = cleanText(b.description, 400);
  const hours = cleanText(b.hours, 80);
  const phone = typeof b.phone === "string" ? normaliseSaPhone(b.phone) : null;
  if (name.length < 2) fields.name = "Enter the business name.";
  if (!DIRECTORY_CATEGORIES[b.category]) fields.category = "Choose what kind of service it is.";
  if (!POLICY.serviceAreas.includes(b.area)) fields.area = "Choose the area.";
  if (!phone) fields.phone = "Enter a South African phone number.";
  if (b.consent !== true) fields.consent = "Please confirm you may publish this number.";
  if (Object.keys(fields).length) return res.status(422).json({ error: "Please check the highlighted fields.", fields });

  const pending = await pool.query("SELECT count(*)::int AS n FROM directory_listings WHERE submitted_by = $1 AND status = 'pending'", [req.user!.id]);
  if (pending.rows[0].n >= 3) return res.status(429).json({ error: "You already have 3 listings waiting for approval." });

  const r = await pool.query(
    `INSERT INTO directory_listings (name, category, description, area, phone, has_whatsapp, hours, submitted_by, consent_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now()) RETURNING id`,
    [name, b.category, description || null, b.area, phone, Boolean(b.hasWhatsapp), hours || null, req.user!.id]
  );
  res.status(201).json({ id: Number(r.rows[0].id), status: "pending" });
});

// GET /api/directory/mine - what I submitted, and what support decided.
directoryRouter.get("/directory/mine", requireAuth, async (req, res) => {
  const r = await pool.query(
    "SELECT id, name, status, decision_note, created_at FROM directory_listings WHERE submitted_by = $1 ORDER BY id DESC LIMIT 20",
    [req.user!.id]
  );
  res.json(r.rows.map((x) => ({ id: Number(x.id), name: x.name, status: x.status, note: x.decision_note, createdAt: x.created_at })));
});

// ---- Support: approve or reject (approvals scope, reason required, audited) ----

directoryRouter.get("/support/directory", requireStaff("approvals"), async (_req, res) => {
  const r = await pool.query(
    `SELECT l.*, u.display_name AS submitted_by_name FROM directory_listings l JOIN users u ON u.id = l.submitted_by
      WHERE l.status = 'pending' ORDER BY l.id`
  );
  res.json(r.rows.map((x) => ({ ...toListing(x), submittedBy: x.submitted_by_name, createdAt: x.created_at })));
});

directoryRouter.post("/support/directory/:id", requireStaff("approvals"), async (req, res) => {
  const decision = req.body?.decision;
  if (!["approve", "reject", "remove"].includes(decision)) return res.status(422).json({ error: "Choose approve, reject or remove." });
  const reason = reasonFrom(req, res);
  if (!reason) return;
  await inTransaction(async (client) => {
    const from = decision === "remove" ? "approved" : "pending";
    const status = decision === "approve" ? "approved" : decision === "reject" ? "rejected" : "removed";
    const r = await client.query(
      `UPDATE directory_listings SET status = $3, decided_by = $4, decided_at = now(), decision_note = $5
        WHERE id = $1 AND status = $2 RETURNING id`,
      [Number(req.params.id), from, status, req.user!.id, reason]
    );
    if (r.rowCount === 0) return void res.status(409).json({ error: "This listing was already handled." });
    await audit(client, {
      actorId: req.user!.id,
      action: `directory.${decision}`,
      resourceType: "directory_listing",
      resourceId: Number(req.params.id),
      outcome: "success",
      reason,
    });
    res.json({ ok: true, status });
  });
});
