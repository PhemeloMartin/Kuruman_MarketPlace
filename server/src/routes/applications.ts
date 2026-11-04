import { Router } from "express";
import { pool } from "../db";
import { requireAuth, requireRole } from "../auth/session";
import { audit } from "../lib/audit";
import { normaliseSaPhone } from "../lib/phone";
import { POLICY } from "../lib/policy";
import { emailAdmin } from "../lib/email";
import { applicantEmails, emailApplicant, noteOnCase } from "../lib/caseMail";
import { encryptBytes } from "../lib/secretBox";
import { canonicalSiteUrl } from "../lib/seo";

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
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// A copy of an ID document may be a photo or a PDF, recognised by the file's first bytes - not by what
// the browser says it is - so nothing else can be stored as an "ID document".
function idDocumentType(file: Buffer): string | null {
  if (file.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return "image/jpeg";
  if (file.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (file.subarray(0, 4).toString("latin1") === "RIFF" && file.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  if (file.subarray(0, 5).toString("latin1") === "%PDF-") return "application/pdf";
  return null;
}

// POST /api/applications - only a plain customer account can apply (one role per account in this MVP).
applicationsRouter.post("/", requireRole("consumer"), async (req, res) => {
  const body = req.body ?? {};
  const fields: Record<string, string> = {};
  let caseType: string;
  let details: Record<string, string>;
  let idDocument: { file: Buffer; type: string } | null = null;

  if (body.type === "seller") {
    caseType = "seller_application";
    const phone = normaliseSaPhone(text(body.phone));
    details = {
      businessName: text(body.businessName),
      description: text(body.description),
      area: text(body.area),
      pickupAddress: text(body.pickupAddress),
      phone: phone ?? "",
      // A helper can apply for a market stall; the stall's phone then gets the orders by SMS.
      kind: body.kind === "market_stall" ? "market_stall" : "shop",
    };
    if (details.businessName.length < 2 || details.businessName.length > 100) fields.businessName = "Enter the business name (2 to 100 characters).";
    if (details.description.length > 500) fields.description = "Keep the description under 500 characters.";
    if (!POLICY.serviceAreas.includes(details.area)) fields.area = "Choose your area from the list.";
    if (details.pickupAddress.length < 5 || details.pickupAddress.length > 200) fields.pickupAddress = "Enter where customers collect orders.";
    if (!phone) fields.phone = "Enter a South African phone number for the business.";

    // Verification, like Payfast's: an email address, a copy of the ID document, and the seller terms
    // and privacy notice accepted. The versions agreed to are saved with the application.
    details.email = text(body.email).toLowerCase();
    if (!EMAIL.test(details.email) || details.email.length > 120) fields.email = "Enter your email address, e.g. name@gmail.com.";
    const file = Buffer.from(text(body.idDocument).replace(/^data:[^,]*,/, ""), "base64");
    const type = idDocumentType(file);
    if (file.length === 0) fields.idDocument = "Add a photo or PDF of your ID document.";
    else if (file.length > POLICY.maxIdDocumentBytes) fields.idDocument = "That file is too big: 5 MB at most.";
    else if (!type) fields.idDocument = "Use a photo (JPG or PNG) or a PDF of your ID document.";
    else idDocument = { file, type };
    if (body.agreeTerms !== true) fields.agreeTerms = "Read and accept the seller terms.";
    if (body.agreePrivacy !== true) fields.agreePrivacy = "Read and accept the privacy notice.";
    details.termsVersion = POLICY.sellerTermsVersion;
    details.privacyVersion = POLICY.privacyNoticeVersion;
    details.agreedAt = new Date().toISOString();
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

  // The application, its ID document and the audit row are saved together - or not at all.
  const client = await pool.connect();
  let caseId: number;
  try {
    await client.query("BEGIN");
    // The partial unique index one_open_application_per_user makes a second waiting
    // application impossible even if two requests arrive together.
    const r = await client.query(
      `INSERT INTO support_cases (case_type, requester_id, details)
       VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [caseType, req.user!.id, details]
    );
    if (r.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "You already have an application waiting for review." });
    }
    caseId = Number(r.rows[0].id);
    if (idDocument) {
      await client.query(
        `INSERT INTO verification_documents (case_id, user_id, kind, content_type, data_enc, bytes)
         VALUES ($1, $2, 'id_document', $3, $4, $5)`,
        [caseId, req.user!.id, idDocument.type, encryptBytes(idDocument.file), idDocument.file.length]
      );
    }
    await audit(client, {
      actorId: req.user!.id,
      action: "application.submit",
      resourceType: "support_case",
      resourceId: caseId,
      outcome: "success",
      changes: { type: caseType, idDocument: Boolean(idDocument) },
    });
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
  res.status(201).json({ id: caseId });

  // Tell the admin by email. Only what's needed to know there's work: no ID document, no phone
  // numbers - those stay in the support console, where every look at them is recorded.
  const seller = caseType === "seller_application";
  await emailAdmin(
    seller ? `New seller application: ${details.businessName}` : "New courier application",
    [
      `${req.user!.displayName.split(" ")[0]} applied to ${seller ? "sell" : "deliver"} on KurumanMarketPlace.`,
      "",
      seller ? `Business: ${details.businessName} (${details.kind === "market_stall" ? "market stall" : "shop"}), ${details.area}` : `Area: ${details.area}`,
      seller ? `ID document: uploaded` : "",
      "",
      `Review it in the support console (Applications): ${canonicalSiteUrl()}/support`,
      "",
      "For privacy, the ID document and phone numbers are not in this email.",
    ].join("\n")
  );
  // And the seller gets a copy for their records, with what happens next.
  if (seller) {
    const e = applicantEmails.received(details.businessName);
    await emailApplicant(caseId, e.subject, e.message, null);
  }
});

// PUT /api/applications/mine/id-document { idDocument } - the applicant sent the wrong or an unclear ID
// document: they replace it while their application waits (never by email). Recorded in the trail.
applicationsRouter.put("/mine/id-document", requireAuth, async (req, res) => {
  const a = await pool.query(
    "SELECT id FROM support_cases WHERE requester_id = $1 AND case_type = 'seller_application' AND status = 'open'",
    [req.user!.id]
  );
  if (a.rowCount === 0) return res.status(404).json({ error: "You have no seller application waiting." });
  const caseId = Number(a.rows[0].id);
  const file = Buffer.from(text(req.body?.idDocument).replace(/^data:[^,]*,/, ""), "base64");
  const type = idDocumentType(file);
  const problem =
    file.length === 0 ? "Add a photo or PDF of your ID document."
    : file.length > POLICY.maxIdDocumentBytes ? "That file is too big: 5 MB at most."
    : !type ? "Use a photo (JPG or PNG) or a PDF of your ID document."
    : null;
  if (problem) return res.status(422).json({ error: problem, fields: { idDocument: problem } });
  await pool.query(
    `INSERT INTO verification_documents (case_id, user_id, kind, content_type, data_enc, bytes)
     VALUES ($1, $2, 'id_document', $3, $4, $5)
     ON CONFLICT (case_id, kind) DO UPDATE
       SET content_type = EXCLUDED.content_type, data_enc = EXCLUDED.data_enc, bytes = EXCLUDED.bytes, created_at = now()`,
    [caseId, req.user!.id, type, encryptBytes(file), file.length]
  );
  await noteOnCase(caseId, "The applicant uploaded a new ID document.", req.user!.id);
  await audit(pool, {
    actorId: req.user!.id,
    action: "application.replace_id_document",
    resourceType: "support_case",
    resourceId: caseId,
    outcome: "success",
  });
  res.json({ ok: true });
});
