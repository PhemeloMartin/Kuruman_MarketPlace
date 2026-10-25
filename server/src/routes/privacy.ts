import { Request, Response, Router } from "express";
import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";
import { pool } from "../db";
import { requireAuth } from "../auth/session";
import { audit } from "../lib/audit";
import { RESEND_AFTER_SECONDS, checkCode, issueCode, useCode } from "../lib/phoneCodes";
import { exportFor, holdsFor } from "../lib/privacy";
import { SMS_DEMO_SHOW_CODES } from "../lib/sms";

// A person's own privacy rights (spec FR-20, UC-16). Mounted at /api/privacy.
// Staff accounts are managed by an administrator, not through these routes.
export const privacyRouter = Router();
privacyRouter.use(requireAuth, (req, res, next) => {
  if (req.user!.role === "support") return res.status(403).json({ error: "Staff accounts are managed by an administrator." });
  next();
});

const LANGUAGES = ["en", "tn", "af"];
const DUE_DAYS = 30; // spec NFR-06: target resolution within 30 days

// Confirming it's really you is the "proportionate verification" for sensitive requests: someone
// who picks up an unlocked phone can't download or close the account. You confirm with a fresh SMS
// code (POST /confirm-code first); demo accounts that have a passphrase may use that instead.
const verifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  keyGenerator: (req) => `privacy-${req.user?.id}`,
  skipSuccessfulRequests: true, // only failed attempts (e.g. a wrong code) count
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many attempts. Please wait 15 minutes and try again." },
});

async function identityConfirmed(req: Request, res: Response): Promise<boolean> {
  const fail = async (error: string, status = 401) => {
    await audit(pool, { actorId: req.user!.id, action: "privacy.verify", resourceType: "user", resourceId: req.user!.id, outcome: "failed" });
    res.status(status).json({ error, fields: { code: error } });
    return false;
  };

  if (typeof req.body?.passphrase === "string") {
    const r = await pool.query("SELECT password_hash FROM users WHERE id = $1", [req.user!.id]);
    if (!r.rows[0]?.password_hash || !(await bcrypt.compare(req.body.passphrase, r.rows[0].password_hash))) {
      return fail("That passphrase isn't right.");
    }
    return true;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const check = await checkCode(client, req.user!.phone, "confirm", req.body?.code);
    if (check.ok) await useCode(client, check.codeId);
    await client.query("COMMIT"); // keeps a counted wrong try, or uses up the right code
    return check.ok ? true : fail(check.error, check.status === 423 ? 423 : 401);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// POST /api/privacy/confirm-code - sends a confirmation code by SMS to the account's own number.
privacyRouter.post("/confirm-code", async (req, res) => {
  const issued = await issueCode(req.user!.phone, "confirm");
  if (!issued.ok) {
    return res.status(429).json({ error: `A code was sent a moment ago. Try again in ${Math.min(issued.waitSeconds, 3600)} seconds.` });
  }
  res.json({ sent: true, resendAfterSeconds: RESEND_AFTER_SECONDS, ...(SMS_DEMO_SHOW_CODES ? { demoCode: issued.code } : {}) });
});

// GET /api/privacy/requests - my privacy requests and what happened to them.
privacyRouter.get("/requests", async (req, res) => {
  const r = await pool.query(
    `SELECT id, case_type, status, resolution, resolution_reason, due_at, created_at, closed_at
       FROM support_cases WHERE requester_id = $1 AND case_type LIKE 'privacy_%' ORDER BY id DESC LIMIT 20`,
    [req.user!.id]
  );
  res.json(
    r.rows.map((c) => ({
      id: Number(c.id),
      type: c.case_type.replace("privacy_", ""),
      status: c.status,
      resolution: c.resolution,
      reason: c.resolution_reason,
      dueAt: c.due_at,
      createdAt: c.created_at,
      closedAt: c.closed_at,
    }))
  );
});

// POST /api/privacy/export { code } - "download my data" (right of access).
// Answered straight away, and still tracked: a closed privacy_access case plus an audit event.
privacyRouter.post("/export", verifyLimiter, async (req, res) => {
  if (!(await identityConfirmed(req, res))) return;
  const data = await exportFor(pool, req.user!.id);
  const c = await pool.query(
    `INSERT INTO support_cases (case_type, requester_id, status, resolution, resolution_reason, closed_at)
     VALUES ('privacy_access', $1, 'closed', 'provided', 'Downloaded by the account holder.', now()) RETURNING id`,
    [req.user!.id]
  );
  await audit(pool, { actorId: req.user!.id, action: "privacy.export", resourceType: "support_case", resourceId: c.rows[0].id, outcome: "success" });
  res.setHeader("Content-Disposition", 'attachment; filename="my-kurumanmarketplace-data.json"');
  res.json(data);
});

// PATCH /api/privacy/profile { displayName?, preferredLanguage? } - correct my own details.
// The phone number isn't here: changing a login number needs a verification code (future work),
// so it's requested through support instead.
privacyRouter.patch("/profile", async (req, res) => {
  const fields: Record<string, string> = {};
  const changes: Record<string, string> = {};
  if (req.body?.displayName !== undefined) {
    const name = typeof req.body.displayName === "string" ? req.body.displayName.trim() : "";
    if (name.length < 2 || name.length > 80) fields.displayName = "Enter your name (2 to 80 characters).";
    else changes.display_name = name;
  }
  if (req.body?.preferredLanguage !== undefined) {
    if (!LANGUAGES.includes(req.body.preferredLanguage)) fields.preferredLanguage = "Choose English, Setswana or Afrikaans.";
    else changes.preferred_language = req.body.preferredLanguage;
  }
  if (Object.keys(fields).length) return res.status(422).json({ error: "Please check the highlighted fields.", fields });
  if (!Object.keys(changes).length) return res.status(422).json({ error: "Nothing to change." });

  const cols = Object.keys(changes);
  await pool.query(
    `UPDATE users SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(", ")}, updated_at = now() WHERE id = $1`,
    [req.user!.id, ...cols.map((c) => changes[c])]
  );
  // The audit records WHICH fields changed, not the new values.
  await audit(pool, { actorId: req.user!.id, action: "privacy.correct", resourceType: "user", resourceId: req.user!.id, outcome: "success", changes: { fields: cols } });
  res.json({ updated: cols });
});

// POST /api/privacy/requests { type: "correction", details } or { type: "deletion", code }
privacyRouter.post("/requests", verifyLimiter, async (req, res) => {
  const type = req.body?.type;
  let details: Record<string, unknown> = {};
  if (type === "correction") {
    const text = typeof req.body.details === "string" ? req.body.details.trim() : "";
    if (text.length < 10 || text.length > 500) {
      return res.status(422).json({ error: "Tell us what needs correcting (10 to 500 characters).", fields: { details: "10 to 500 characters." } });
    }
    details = { text };
  } else if (type === "deletion") {
    if (!(await identityConfirmed(req, res))) return;
    // Shown to support straight away; checked again when they act.
    details = { holdsAtRequest: await holdsFor(pool, req.user!.id) };
  } else {
    return res.status(422).json({ error: "Choose the kind of request." });
  }

  const r = await pool.query(
    `INSERT INTO support_cases (case_type, requester_id, details, due_at)
     VALUES ($1, $2, $3, now() + make_interval(days => $4))
     ON CONFLICT DO NOTHING RETURNING id`,
    [`privacy_${type}`, req.user!.id, details, DUE_DAYS]
  );
  if (r.rowCount === 0) return res.status(409).json({ error: "You already have a request like this being handled." });
  await audit(pool, { actorId: req.user!.id, action: `privacy.request_${type}`, resourceType: "support_case", resourceId: r.rows[0].id, outcome: "success" });
  res.status(201).json({ id: Number(r.rows[0].id) });
});
