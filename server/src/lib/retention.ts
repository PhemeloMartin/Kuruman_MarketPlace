import { pool } from "../db";
import { audit } from "./audit";

// Scheduled clean-up of data we no longer need (spec BR-16 and Table 38 "proposed retention").
// The periods are the spec's PROPOSALS for the academic pilot; before real use the Information
// Officer must approve them. Anything tied to an open support case is left alone (a hold).
//
// Not done here, on purpose: the audit log is append-only for the application (a database
// trigger), so its 90-day clean-up needs a separate, privileged database role once hosted.
export async function runRetention() {
  // Delivery addresses and notes: 30 days after the order finished.
  const addresses = await pool.query(
    `UPDATE orders o
        SET delivery_address = CASE WHEN o.fulfilment = 'delivery' THEN '[removed after 30 days]' END, notes = NULL
      WHERE o.status IN ('completed', 'cancelled', 'declined', 'expired')
        AND o.updated_at < now() - interval '30 days'
        AND (o.notes IS NOT NULL OR (o.fulfilment = 'delivery' AND o.delivery_address NOT LIKE '[removed%'))
        AND NOT EXISTS (SELECT 1 FROM support_cases c WHERE c.order_id = o.id AND c.status = 'open')`
  );
  // Sessions that can no longer be used (expired, or idle past the limit): nothing to keep.
  const sessions = await pool.query(
    `DELETE FROM sessions WHERE expires_at < now() - interval '1 day' OR last_seen_at < now() - interval '1 day'`
  );
  // AI suggestion outcomes: 30 days (spec 8.2).
  const ai = await pool.query(`DELETE FROM ai_suggestions WHERE created_at < now() - interval '30 days'`);
  // Closed cases: keep the decision, erase what people wrote, after 90 days.
  const cases = await pool.query(
    `UPDATE support_cases SET details = '{"erased": true}'
      WHERE status = 'closed' AND closed_at < now() - interval '90 days' AND details <> '{"erased": true}'::jsonb`
  );

  const counts = {
    addressesErased: addresses.rowCount ?? 0,
    sessionsDeleted: sessions.rowCount ?? 0,
    aiSuggestionsDeleted: ai.rowCount ?? 0,
    caseDetailsErased: cases.rowCount ?? 0,
  };
  if (Object.values(counts).some((n) => n > 0)) {
    await audit(pool, { actorId: null, action: "retention.run", resourceType: "system", resourceId: "retention", outcome: "success", changes: counts });
  }
  return counts;
}

// Once when the server starts, then every 6 hours.
export function startRetentionTimer(): void {
  const run = () =>
    runRetention()
      .then((c) => Object.values(c).some((n) => n > 0) && console.log("Retention clean-up:", c))
      .catch((err) => console.error("Retention clean-up failed:", err));
  run();
  setInterval(run, 6 * 60 * 60 * 1000).unref();
}
