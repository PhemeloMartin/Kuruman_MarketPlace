import { PoolClient } from "pg";

// Queues an event in the transactional outbox (spec Table 79). Call it with the SAME client as
// the business change, inside its transaction: both are saved together or not at all.
// ON CONFLICT DO NOTHING on dedupe_key means replaying the same event (a duplicate Payfast
// notification, a retried request) never queues it twice - spec 7.3: "one notification intent".
export async function enqueue(
  client: PoolClient,
  e: { type: string; aggregateId: number; dedupeKey: string; payload?: Record<string, unknown> }
): Promise<void> {
  await client.query(
    `INSERT INTO outbox_events (event_type, aggregate_id, dedupe_key, payload)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (dedupe_key) DO NOTHING`,
    [e.type, e.aggregateId, e.dedupeKey, e.payload ?? {}]
  );
}
