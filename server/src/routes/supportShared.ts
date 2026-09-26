import { Request, Response } from "express";
import { PoolClient } from "pg";
import { pool } from "../db";

// Helpers used by every support route file (support.ts, supportMoney.ts).

// Every support decision needs a reason a colleague or auditor can read later.
export function reasonFrom(req: Request, res: Response): string | null {
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
  if (reason.length < 5 || reason.length > 500) {
    res.status(422).json({ error: "Write a short reason for this decision.", fields: { reason: "5 to 500 characters." } });
    return null;
  }
  return reason;
}

// Runs `work` in a transaction; any error rolls everything back, including the audit row.
export async function inTransaction(work: (client: PoolClient) => Promise<void>) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await work(client);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function closeCase(client: PoolClient, caseId: number, resolution: string, reason: string, staffId: number) {
  await client.query(
    `UPDATE support_cases SET status = 'closed', resolution = $2, resolution_reason = $3,
            resolved_by = $4, closed_at = now()
      WHERE id = $1`,
    [caseId, resolution, reason, staffId]
  );
}
