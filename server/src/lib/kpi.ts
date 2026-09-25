import { Pool, PoolClient } from "pg";

// Entrepreneur KPIs, following spec section 7.5, Table 32.
// None of these is "profit": product costs, expenses and tax are not modelled.
// Digital-payment metrics (net collections, unapplied money) are added with Payfast.
export interface Kpis {
  pendingOrders: number;
  grossDeliveredCents: number; // subtotals of orders completed in the period (no delivery fees)
  completedOrders: number;
  averageCompletedCents: number | null; // null = N/A (no completed orders)
  acceptanceRate: number | null; // 0..1, null = N/A (no decided orders)
  unreconciledCashCents: number; // cash collected but not yet handed to the business
  lowStockProducts: number;
}

type Db = Pool | PoolClient;

export async function computeKpis(db: Db, businessId: number, from: Date, to: Date): Promise<Kpis> {
  // Pending orders: right now, not limited to the period.
  const pending = await db.query(
    "SELECT count(*)::int AS n FROM orders WHERE business_id = $1 AND status = 'pending_acceptance'",
    [businessId]
  );

  // Gross delivered product sales: subtotal_cents of orders that reached COMPLETED inside the period.
  const delivered = await db.query(
    `SELECT count(*)::int AS n, COALESCE(sum(o.subtotal_cents), 0)::int AS cents
       FROM orders o
      WHERE o.business_id = $1
        AND o.status = 'completed'
        AND EXISTS (SELECT 1 FROM order_status_history h
                     WHERE h.order_id = o.id AND h.to_status = 'completed'
                       AND h.created_at >= $2 AND h.created_at < $3)`,
    [businessId, from, to]
  );

  // Acceptance rate for orders submitted in the period:
  // accepted / decided, where decided = accepted, declined, or expired without acceptance.
  // Still-pending orders and customer cancellations before a decision are left out.
  const acceptance = await db.query(
    `WITH cohort AS (
       SELECT o.id, o.status,
              EXISTS (SELECT 1 FROM order_status_history h
                       WHERE h.order_id = o.id AND h.from_status = 'pending_acceptance'
                         AND h.to_status IN ('confirmed', 'awaiting_payment')) AS accepted
         FROM orders o
        WHERE o.business_id = $1 AND o.created_at >= $2 AND o.created_at < $3
     )
     SELECT count(*) FILTER (WHERE accepted)::int AS accepted,
            count(*) FILTER (WHERE accepted OR status IN ('declined', 'expired'))::int AS decided
       FROM cohort`,
    [businessId, from, to]
  );

  // Unreconciled cash: collected minus remitted, at report time.
  const cash = await db.query(
    `SELECT COALESCE(sum(c.collected_cents - c.remitted_cents), 0)::int AS cents
       FROM cash_receipts c JOIN orders o ON o.id = c.order_id
      WHERE o.business_id = $1`,
    [businessId]
  );

  // Low stock: active products whose available units are at or below their threshold.
  const low = await db.query(
    `SELECT count(*)::int AS n FROM products
      WHERE business_id = $1 AND is_active AND stock_qty - reserved_qty <= low_stock_threshold`,
    [businessId]
  );

  const completedOrders = delivered.rows[0].n;
  const grossDeliveredCents = delivered.rows[0].cents;
  const { accepted, decided } = acceptance.rows[0];

  return {
    pendingOrders: pending.rows[0].n,
    grossDeliveredCents,
    completedOrders,
    averageCompletedCents: completedOrders ? grossDeliveredCents / completedOrders : null,
    acceptanceRate: decided ? accepted / decided : null,
    unreconciledCashCents: cash.rows[0].cents,
    lowStockProducts: low.rows[0].n,
  };
}
