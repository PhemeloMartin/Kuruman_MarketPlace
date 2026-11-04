import { Router } from "express";
import { pool } from "../db";
import { requireAuth, requireRole } from "../auth/session";
import { audit } from "../lib/audit";
import { normaliseSaPhone } from "../lib/phone";
import { POLICY } from "../lib/policy";
import { emailAdmin } from "../lib/email";
import { applicantEmails, applicationWhat, emailApplicant, noteOnCase } from "../lib/caseMail";
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

// The documents someone applying must upload, like Payfast's verification:
//   - everyone: their ID document;
//   - couriers: also a police clearance certificate (SAPS) - they go to people's homes and carry their
//     orders and cash - and, if they deliver with a motorbike, car or bakkie, their driver's licence.
export const DOCUMENT_LABEL: Record<string, string> = {
  id_document: "ID document",
  drivers_licence: "driver's licence",
  police_clearance: "police clearance certificate",
};
const FIELD: Record<string, string> = { id_document: "idDocument", drivers_licence: "driversLicence", police_clearance: "policeClearance" };
export const MOTORISED = ["motorbike", "car", "bakkie"];

export function requiredDocuments(caseType: string, details: Record<string, string>): string[] {
  if (caseType === "seller_application") return ["id_document"];
  return MOTORISED.includes(details.vehicleType) ? ["id_document", "drivers_licence", "police_clearance"] : ["id_document", "police_clearance"];
}

// A document may be a photo or a PDF, recognised by the file's first bytes - not by what the browser says
// it is - so nothing else can be stored as one.
function documentType(file: Buffer): string | null {
  if (file.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return "image/jpeg";
  if (file.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (file.subarray(0, 4).toString("latin1") === "RIFF" && file.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  if (file.subarray(0, 5).toString("latin1") === "%PDF-") return "application/pdf";
  return null;
}

// Reads one uploaded document (sent as base64 text) and checks it.
function readDocument(value: unknown, label: string): { file: Buffer; type: string } | { problem: string } {
  const file = Buffer.from(text(value).replace(/^data:[^,]*,/, ""), "base64");
  const type = documentType(file);
  if (file.length === 0) return { problem: `Add a photo or PDF of your ${label}.` };
  if (file.length > POLICY.maxIdDocumentBytes) return { problem: "That file is too big: 5 MB at most." };
  if (!type) return { problem: `Use a photo (JPG or PNG) or a PDF of your ${label}.` };
  return { file, type };
}

// Stores a document encrypted; a new one of the same kind replaces the old one.
async function saveDocument(db: { query: typeof pool.query }, caseId: number, userId: number, kind: string, d: { file: Buffer; type: string }) {
  await db.query(
    `INSERT INTO verification_documents (case_id, user_id, kind, content_type, data_enc, bytes)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (case_id, kind) DO UPDATE
       SET content_type = EXCLUDED.content_type, data_enc = EXCLUDED.data_enc, bytes = EXCLUDED.bytes, created_at = now()`,
    [caseId, userId, kind, d.type, encryptBytes(d.file), d.file.length]
  );
}

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
      // A helper can apply for a market stall; the stall's phone then gets the orders by SMS.
      kind: body.kind === "market_stall" ? "market_stall" : "shop",
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
  const seller = caseType === "seller_application";

  // Verification for everyone, like Payfast's: an email address, the documents, and the terms and the
  // privacy notice accepted. The versions agreed to are saved with the application.
  details.email = text(body.email).toLowerCase();
  if (!EMAIL.test(details.email) || details.email.length > 120) fields.email = "Enter your email address, e.g. name@gmail.com.";
  const documents: { kind: string; file: Buffer; type: string }[] = [];
  for (const kind of requiredDocuments(caseType, details)) {
    const d = readDocument(body[FIELD[kind]], DOCUMENT_LABEL[kind]);
    if ("problem" in d) fields[FIELD[kind]] = d.problem;
    else documents.push({ kind, ...d });
  }
  if (body.agreeTerms !== true) fields.agreeTerms = `Read and accept the ${seller ? "seller" : "courier"} terms.`;
  if (body.agreePrivacy !== true) fields.agreePrivacy = "Read and accept the privacy notice.";
  details.termsVersion = seller ? POLICY.sellerTermsVersion : POLICY.courierTermsVersion;
  details.privacyVersion = POLICY.privacyNoticeVersion;
  details.agreedAt = new Date().toISOString();

  if (Object.keys(fields).length > 0) {
    return res.status(422).json({ error: "Please check the highlighted fields.", fields });
  }

  // The application, its documents and the audit row are saved together - or not at all.
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
    for (const d of documents) await saveDocument(client, caseId, req.user!.id, d.kind, d);
    await audit(client, {
      actorId: req.user!.id,
      action: "application.submit",
      resourceType: "support_case",
      resourceId: caseId,
      outcome: "success",
      changes: { type: caseType, documents: documents.map((d) => d.kind) },
    });
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
  res.status(201).json({ id: caseId });

  // Tell the admin by email. Only what's needed to know there's work: no documents, no phone numbers -
  // those stay in the support console, where every look at a document is recorded.
  await emailAdmin(
    seller ? `New seller application: ${details.businessName}` : `New courier application: ${details.area}`,
    [
      `${req.user!.displayName.split(" ")[0]} applied to ${seller ? "sell" : "deliver"} on KurumanMarketPlace.`,
      "",
      seller
        ? `Business: ${details.businessName} (${details.kind === "market_stall" ? "market stall" : "shop"}), ${details.area}`
        : `Area: ${details.area}, delivers by ${details.vehicleType.replace("_", " ")}`,
      `Documents uploaded: ${documents.map((d) => DOCUMENT_LABEL[d.kind]).join(", ")}`,
      "",
      `Review it in the support console (Applications): ${canonicalSiteUrl()}/support`,
      "",
      "For privacy, the documents and phone numbers are not in this email.",
    ].join("\n")
  );
  // And the applicant gets a copy for their records, with what happens next.
  const e = applicantEmails.received(applicationWhat(caseType, details), seller);
  await emailApplicant(caseId, e.subject, e.message, null);
});

// PUT /api/applications/mine/documents/:kind { file } - the applicant sent a wrong or unclear document:
// they replace it while their application waits (never by email). Recorded in the trail.
applicationsRouter.put("/mine/documents/:kind", requireAuth, async (req, res) => {
  const a = await pool.query(
    "SELECT id, case_type, details FROM support_cases WHERE requester_id = $1 AND case_type IN ('seller_application', 'courier_application') AND status = 'open'",
    [req.user!.id]
  );
  if (a.rowCount === 0) return res.status(404).json({ error: "You have no application waiting." });
  const app = a.rows[0];
  const kind = String(req.params.kind);
  if (!requiredDocuments(app.case_type, app.details).includes(kind)) return res.status(404).json({ error: "Not a document for this application." });
  const d = readDocument(req.body?.file, DOCUMENT_LABEL[kind]);
  if ("problem" in d) return res.status(422).json({ error: d.problem, fields: { file: d.problem } });
  await saveDocument(pool, Number(app.id), req.user!.id, kind, d);
  await noteOnCase(Number(app.id), `The applicant uploaded a new ${DOCUMENT_LABEL[kind]}.`, req.user!.id);
  await audit(pool, {
    actorId: req.user!.id,
    action: "application.replace_document",
    resourceType: "support_case",
    resourceId: Number(app.id),
    outcome: "success",
    changes: { kind },
  });
  res.json({ ok: true });
});
