import { Pool, PoolClient } from "pg";
import { audit } from "./audit";

// Privacy rights (spec FR-20, UC-16, BR-16, Table 38).
//
// Closing an account is NOT the same as deleting every row about the person: orders, payments,
// refunds and cash records are business evidence other people rely on (the seller, the courier,
// tax records). So we erase what identifies or contacts the person, and keep the transactions
// linked to the same user id - now labelled "Closed account". That is pseudonymisation, and
// the privacy notice says so plainly rather than promising total erasure.

type Db = Pool | PoolClient;

const ACTIVE_ORDER = `('pending_acceptance', 'awaiting_payment', 'confirmed', 'ready', 'out_for_delivery', 'delivery_failed')`;

// "Lawful holds": reasons the account can't be closed YET, because other people or open money
// depend on it. Each is plain language, shown to support and (as a summary) to the person.
export async function holdsFor(db: Db, userId: number): Promise<string[]> {
  const holds: string[] = [];
  const q = async (sql: string) => (await db.query(sql, [userId])).rows[0].n as number;

  const myOrders = await q(`SELECT count(*)::int AS n FROM orders WHERE consumer_id = $1 AND status IN ${ACTIVE_ORDER}`);
  if (myOrders) holds.push(`${myOrders} order(s) you placed are still in progress.`);

  const shopOrders = await q(
    `SELECT count(*)::int AS n FROM orders o JOIN businesses b ON b.id = o.business_id
      WHERE b.owner_id = $1 AND (o.status IN ${ACTIVE_ORDER}
            OR EXISTS (SELECT 1 FROM deliveries d WHERE d.order_id = o.id AND d.status = 'failed' AND d.returned_at IS NULL))`
  );
  if (shopOrders) holds.push(`${shopOrders} order(s) to your shop are still in progress.`);

  const jobs = await q(
    `SELECT count(*)::int AS n FROM deliveries
      WHERE courier_id = $1 AND (status IN ('claimed', 'collected') OR (status = 'failed' AND returned_at IS NULL))`
  );
  if (jobs) holds.push(`${jobs} delivery job(s) are still with you.`);

  const cash = await q(
    `SELECT count(*)::int AS n FROM cash_receipts c JOIN orders o ON o.id = c.order_id JOIN businesses b ON b.id = o.business_id
      WHERE c.status <> 'remitted' AND (c.collected_by = $1 OR b.owner_id = $1)`
  );
  if (cash) holds.push(`${cash} cash handover(s) are not settled yet.`);

  const cases = await q(
    `SELECT count(*)::int AS n FROM support_cases c LEFT JOIN orders o ON o.id = c.order_id
       LEFT JOIN businesses b ON b.id = o.business_id
      WHERE c.status = 'open' AND c.order_id IS NOT NULL   -- applications aren't holds: they're withdrawn
        AND (c.requester_id = $1 OR o.consumer_id = $1 OR b.owner_id = $1)`
  );
  if (cases) holds.push(`${cases} support case(s) about your orders are still open (for example a refund).`);

  return holds;
}

// Erases what identifies or contacts the person. Call inside a transaction, after holdsFor()
// returned nothing. Every step is listed so it can be checked against spec section 6.4.
export async function closeAccount(client: PoolClient, userId: number, staffId: number, reason: string): Promise<void> {
  // 1. Sign them out everywhere.
  await client.query("DELETE FROM sessions WHERE user_id = $1", [userId]);
  // 2. Login details and name: erased; the row stays as a neutral surrogate for old records.
  await client.query(
    `UPDATE users SET phone = NULL, password_hash = NULL, display_name = 'Closed account', is_active = FALSE,
            totp_secret_enc = NULL, totp_pending_enc = NULL, closed_at = now(), updated_at = now()
      WHERE id = $1`,
    [userId]
  );
  // 3. Where they had things delivered, and any notes they wrote to sellers.
  await client.query(
    `UPDATE orders SET delivery_address = CASE WHEN fulfilment = 'delivery' THEN '[removed at account closure]' END,
            notes = NULL
      WHERE consumer_id = $1`,
    [userId]
  );
  // 4. A seller's shop: hidden, listings off, contact details erased. The trading name stays on
  //    old receipts, because customers' records of who they bought from are business evidence.
  const b = await client.query(
    `UPDATE businesses SET is_active = FALSE, phone = '[removed]', pickup_address = '[removed at account closure]',
            description = NULL
      WHERE owner_id = $1 RETURNING id`,
    [userId]
  );
  if (b.rowCount) await client.query("UPDATE products SET is_active = FALSE WHERE business_id = $1", [b.rows[0].id]);
  // 5. A courier can't take jobs any more.
  await client.query("UPDATE courier_profiles SET is_active = FALSE WHERE user_id = $1", [userId]);
  // 6. A seller/courier application still waiting is withdrawn - nobody else depends on it.
  await client.query(
    `UPDATE support_cases SET status = 'closed', resolution = 'withdrawn',
            resolution_reason = 'Account closed at the holder''s request.', resolved_by = $2, closed_at = now()
      WHERE requester_id = $1 AND status = 'open' AND case_type IN ('seller_application', 'courier_application')`,
    [userId, staffId]
  );
  // 7. What they wrote in applications and problem reports (addresses, phone numbers, free text).
  await client.query(`UPDATE support_cases SET details = '{"erased": true}' WHERE requester_id = $1`, [userId]);

  await audit(client, {
    actorId: staffId,
    action: "account.close",
    resourceType: "user",
    resourceId: userId,
    outcome: "success",
    reason,
    changes: { shopClosed: Boolean(b.rowCount) },
  });
}

// Everything we hold about the signed-in person - and nothing about anyone else
// (spec TC-20: "one user's request cannot disclose another's information").
// For a seller, orders to their shop are summarised, because they contain customers' details.
export async function exportFor(db: Db, userId: number) {
  const u = (
    await db.query(
      "SELECT id, phone, display_name, role, preferred_language, created_at, updated_at FROM users WHERE id = $1",
      [userId]
    )
  ).rows[0];
  const orders = await db.query(
    `SELECT o.order_number, o.status, o.fulfilment, o.payment_method, o.total_cents, o.delivery_address, o.notes,
            o.created_at, b.name AS business,
            (SELECT json_agg(json_build_object('product', i.product_name, 'quantity', i.quantity,
                                               'unitPriceCents', i.unit_price_cents) ORDER BY i.id)
               FROM order_items i WHERE i.order_id = o.id) AS items,
            (SELECT json_agg(json_build_object('status', p.status, 'amountCents', p.amount_cents, 'at', p.created_at) ORDER BY p.id)
               FROM payments p WHERE p.order_id = o.id) AS payments,
            (SELECT json_agg(json_build_object('status', f.status, 'amountCents', f.amount_cents, 'at', f.requested_at) ORDER BY f.id)
               FROM refunds f WHERE f.order_id = o.id) AS refunds
       FROM orders o JOIN businesses b ON b.id = o.business_id
      WHERE o.consumer_id = $1 ORDER BY o.id`,
    [userId]
  );
  const business = await db.query(
    `SELECT b.name, b.description, b.area, b.pickup_address, b.phone, b.is_active, b.created_at,
            (SELECT count(*)::int FROM orders o WHERE o.business_id = b.id) AS orders_received,
            (SELECT json_agg(json_build_object('name', p.name, 'priceCents', p.price_cents, 'stock', p.stock_qty,
                                               'active', p.is_active) ORDER BY p.id)
               FROM products p WHERE p.business_id = b.id) AS products
       FROM businesses b WHERE b.owner_id = $1`,
    [userId]
  );
  const courier = await db.query("SELECT vehicle_type, area, is_active, approved_at FROM courier_profiles WHERE user_id = $1", [userId]);
  const deliveries = await db.query(
    `SELECT o.order_number, d.status, d.fee_cents, d.claimed_at, d.delivered_at
       FROM deliveries d JOIN orders o ON o.id = d.order_id WHERE d.courier_id = $1 ORDER BY d.id`,
    [userId]
  );
  const requests = await db.query(
    `SELECT case_type, status, resolution, resolution_reason, created_at, closed_at
       FROM support_cases WHERE requester_id = $1 ORDER BY id`,
    [userId]
  );
  const sessions = await db.query(
    "SELECT created_at, last_seen_at, expires_at FROM sessions WHERE user_id = $1 ORDER BY id",
    [userId]
  );
  return {
    about: "Personal information KurumanMarketPlace holds about you, as at the time of this download.",
    generatedAt: new Date().toISOString(),
    account: {
      phone: u.phone,
      name: u.display_name,
      role: u.role,
      language: u.preferred_language,
      createdAt: u.created_at,
      updatedAt: u.updated_at,
      passphrase: "Stored only as a one-way hash, which can't be turned back into your passphrase.",
    },
    signedInSessions: sessions.rows,
    ordersYouPlaced: orders.rows,
    yourShop: business.rows[0] ?? null,
    courierProfile: courier.rows[0] ?? null,
    deliveriesYouMade: deliveries.rows,
    requestsAndApplications: requests.rows,
  };
}
