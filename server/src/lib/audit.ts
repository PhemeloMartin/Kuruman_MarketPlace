import { Pool, PoolClient } from "pg";

// Writes one row to the append-only audit log (spec FR-22).
// Pass the transaction's client when the action is part of a transaction, so the audit row
// is saved together with the change - or not at all if the change is rolled back.
// Only identifiers, outcomes and allow-listed numbers/statuses go in `changes`:
// never passphrases, codes, addresses or card data.
export interface AuditEvent {
  actorId: number | null;
  action: string; // e.g. "application.approve"
  resourceType: string; // e.g. "support_case"
  resourceId: string | number;
  outcome: "success" | "refused" | "failed";
  reason?: string | null;
  changes?: Record<string, unknown> | null;
}

export async function audit(db: Pool | PoolClient, e: AuditEvent): Promise<void> {
  await db.query(
    `INSERT INTO audit_events (actor_user_id, action, resource_type, resource_id, outcome, reason, changes)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [e.actorId, e.action, e.resourceType, String(e.resourceId), e.outcome, e.reason ?? null, e.changes ?? null]
  );
}
