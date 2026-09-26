import { PoolClient } from "pg";
import { audit } from "./audit";

// Opens a support case for an order automatically, inside the caller's transaction - so the
// problem and the case that tracks it are saved together (spec FR-21, BR-08, BR-11).
// If the order already has an open case of this kind, nothing new is created: the index
// one_open_case_per_order makes the INSERT do nothing, and support sees one case per problem.
export async function openOrderCase(
  client: PoolClient,
  c: { type: "refund" | "cash_dispute" | "fulfilment" | "order_problem"; orderId: number; requesterId: number; details: Record<string, unknown>; actorId: number | null }
): Promise<void> {
  const r = await client.query(
    `INSERT INTO support_cases (case_type, requester_id, order_id, details)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [c.type, c.requesterId, c.orderId, c.details]
  );
  if (r.rowCount) {
    await audit(client, {
      actorId: c.actorId,
      action: "case.open",
      resourceType: "support_case",
      resourceId: r.rows[0].id,
      outcome: "success",
      changes: { type: c.type, orderId: c.orderId },
    });
  }
}
