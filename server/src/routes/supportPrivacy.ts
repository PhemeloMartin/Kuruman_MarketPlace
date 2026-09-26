import { Router } from "express";
import { PoolClient } from "pg";
import { pool } from "../db";
import { requireStaff } from "../auth/session";
import { audit } from "../lib/audit";
import { closeAccount, holdsFor } from "../lib/privacy";
import { closeCase, inTransaction, reasonFrom } from "./supportShared";
import { enqueue } from "../lib/outbox";

// Privacy requests in the support console (spec FR-20, UC-16, TC-20).
// Mounted at /api/support/privacy; needs the "privacy" scope - staff without it can't even list
// these cases (spec Table 12: "privacy-authorised staff only").
export const supportPrivacyRouter = Router();
supportPrivacyRouter.use(requireStaff("privacy"));

// GET /api/support/privacy/cases - open requests (oldest due first), then recent decisions.
// For account closures the current holds are worked out live, not trusted from the request time.
supportPrivacyRouter.get("/cases", async (_req, res) => {
  const r = await pool.query(
    `(SELECT c.*, u.display_name, u.role, s.display_name AS resolved_by_name
        FROM support_cases c JOIN users u ON u.id = c.requester_id LEFT JOIN users s ON s.id = c.resolved_by
       WHERE c.case_type IN ('privacy_correction', 'privacy_deletion') AND c.status = 'open'
       ORDER BY c.due_at)
     UNION ALL
     (SELECT c.*, u.display_name, u.role, s.display_name AS resolved_by_name
        FROM support_cases c JOIN users u ON u.id = c.requester_id LEFT JOIN users s ON s.id = c.resolved_by
       WHERE c.case_type LIKE 'privacy_%' AND c.status = 'closed'
       ORDER BY c.closed_at DESC LIMIT 20)`
  );
  const out = [];
  for (const c of r.rows) {
    out.push({
      id: Number(c.id),
      type: c.case_type.replace("privacy_", ""),
      status: c.status,
      requester: { id: Number(c.requester_id), name: c.display_name, role: c.role },
      details: c.details,
      holds: c.status === "open" && c.case_type === "privacy_deletion" ? await holdsFor(pool, Number(c.requester_id)) : [],
      dueAt: c.due_at,
      createdAt: c.created_at,
      closedAt: c.closed_at,
      resolution: c.resolution,
      reason: c.resolution_reason,
      resolvedBy: c.resolved_by_name,
    });
  }
  res.json(out);
});

async function lockOpenPrivacyCase(client: PoolClient, id: number) {
  const r = Number.isInteger(id)
    ? await client.query("SELECT * FROM support_cases WHERE id = $1 AND case_type LIKE 'privacy_%' FOR UPDATE", [id])
    : { rows: [] as any[] };
  return r.rows[0] ?? null;
}

// POST /api/support/privacy/cases/:id/close-account { reason }
// Refused while any hold exists - the holds are re-checked here, inside the transaction,
// with the person's row locked, so nothing can start in between.
supportPrivacyRouter.post("/cases/:id/close-account", async (req, res) => {
  const reason = reasonFrom(req, res);
  if (!reason) return;
  await inTransaction(async (client) => {
    const c = await lockOpenPrivacyCase(client, Number(req.params.id));
    if (!c || c.case_type !== "privacy_deletion") return void res.status(404).json({ error: "Request not found." });
    if (c.status !== "open") return void res.status(409).json({ error: "This request has already been handled." });
    const u = await client.query("SELECT role FROM users WHERE id = $1 FOR UPDATE", [c.requester_id]);
    if (u.rows[0].role === "support") return void res.status(409).json({ error: "Staff accounts are closed by an administrator." });
    const holds = await holdsFor(client, Number(c.requester_id));
    if (holds.length) {
      return void res.status(409).json({ error: "The account can't be closed yet.", holds });
    }
    await closeAccount(client, Number(c.requester_id), req.user!.id, reason);
    await closeCase(client, Number(c.id), "account_closed", reason, req.user!.id);
    res.json({ status: "account_closed" });
  });
});

// POST /api/support/privacy/cases/:id/hold { reason } - explain to the person why the account
// can't be closed yet (a lawful hold). They see the reason and can ask again later.
supportPrivacyRouter.post("/cases/:id/hold", async (req, res) => {
  const reason = reasonFrom(req, res);
  if (!reason) return;
  await inTransaction(async (client) => {
    const c = await lockOpenPrivacyCase(client, Number(req.params.id));
    if (!c) return void res.status(404).json({ error: "Request not found." });
    if (c.status !== "open") return void res.status(409).json({ error: "This request has already been handled." });
    await closeCase(client, Number(c.id), "held", reason, req.user!.id);
    await enqueue(client, { type: "privacy.held", aggregateId: Number(c.id), dedupeKey: `privacy-held:${c.id}`, payload: { userId: Number(c.requester_id) } });
    await audit(client, { actorId: req.user!.id, action: "privacy.hold", resourceType: "support_case", resourceId: c.id, outcome: "success", reason });
    res.json({ status: "held" });
  });
});

// POST /api/support/privacy/cases/:id/resolve { reason } - a correction request was carried out.
supportPrivacyRouter.post("/cases/:id/resolve", async (req, res) => {
  const reason = reasonFrom(req, res);
  if (!reason) return;
  await inTransaction(async (client) => {
    const c = await lockOpenPrivacyCase(client, Number(req.params.id));
    if (!c || c.case_type !== "privacy_correction") return void res.status(404).json({ error: "Request not found." });
    if (c.status !== "open") return void res.status(409).json({ error: "This request has already been handled." });
    await closeCase(client, Number(c.id), "corrected", reason, req.user!.id);
    await audit(client, { actorId: req.user!.id, action: "privacy.resolve", resourceType: "support_case", resourceId: c.id, outcome: "success", reason });
    res.json({ status: "corrected" });
  });
});
