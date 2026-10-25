import { pool } from "../db";

// "Entrepreneur of the Month": one shop highlighted on the Home screen, chosen by a published formula
// over the last 30 days, using ONLY what happened on the site. Sales arranged elsewhere (e.g. paid on
// WhatsApp) can't count, which gives sellers a reason to keep their orders on the platform.
//
// Who can win: an active shop with at least MIN_ORDERS completed orders AND at least MIN_REVIEWS
// reviews in the period (so one lucky 5-star review can't win it).
//
// Score (0 to 100):
//   50 x  completed orders / the highest number of completed orders of any eligible shop
//   30 x  average rating / 5
//   20 x  acceptance rate (orders accepted / orders the shop answered or let expire)
// Ties go to the shop with more reviews.

export const SPOTLIGHT_DAYS = 30;
const MIN_ORDERS = 3;
const MIN_REVIEWS = 3;

export const SPOTLIGHT_RULE =
  `Chosen from the last ${SPOTLIGHT_DAYS} days on KurumanMarketPlace: half for completed orders, 30% for ` +
  `customer ratings and 20% for answering orders. Shops need at least ${MIN_ORDERS} completed orders and ` +
  `${MIN_REVIEWS} reviews. Only orders placed and completed on the site count.`;

export async function currentSpotlight() {
  const r = await pool.query(
    `WITH period AS (SELECT now() - make_interval(days => $1) AS since),
     stats AS (
       SELECT b.id, b.name, b.area, b.description, b.cover_photo_url,
              (SELECT count(*) FROM orders o
                 WHERE o.business_id = b.id AND o.status = 'completed'
                   AND EXISTS (SELECT 1 FROM order_status_history h, period
                                WHERE h.order_id = o.id AND h.to_status = 'completed' AND h.created_at >= period.since)
              )::int AS completed,
              (SELECT avg(rv.rating) FROM reviews rv, period
                 WHERE rv.business_id = b.id AND rv.hidden_at IS NULL AND rv.created_at >= period.since)::float AS rating,
              (SELECT count(*) FROM reviews rv, period
                 WHERE rv.business_id = b.id AND rv.hidden_at IS NULL AND rv.created_at >= period.since)::int AS reviews,
              -- Same rule as the seller dashboard: accepted / (accepted + declined + expired).
              (SELECT count(*) FILTER (WHERE accepted)::float
                      / NULLIF(count(*) FILTER (WHERE accepted OR status IN ('declined', 'expired')), 0)
                 FROM (SELECT o.status,
                              EXISTS (SELECT 1 FROM order_status_history h
                                       WHERE h.order_id = o.id AND h.from_status = 'pending_acceptance'
                                         AND h.to_status IN ('confirmed', 'awaiting_payment')) AS accepted
                         FROM orders o, period
                        WHERE o.business_id = b.id AND o.created_at >= period.since) d
              ) AS acceptance
         FROM businesses b
        WHERE b.is_active
     ),
     eligible AS (SELECT * FROM stats WHERE completed >= $2 AND reviews >= $3)
     SELECT e.*,
            50.0 * e.completed / (SELECT max(completed) FROM eligible)
            + 30.0 * e.rating / 5
            + 20.0 * COALESCE(e.acceptance, 0) AS score
       FROM eligible e
      ORDER BY score DESC, e.reviews DESC, e.id
      LIMIT 1`,
    [SPOTLIGHT_DAYS, MIN_ORDERS, MIN_REVIEWS]
  );
  const w = r.rows[0];
  if (!w) return null;
  return {
    business: { id: Number(w.id), name: w.name, area: w.area, description: w.description, coverPhotoUrl: w.cover_photo_url },
    completedOrders: w.completed,
    averageRating: Math.round(w.rating * 10) / 10,
    reviewCount: w.reviews,
    acceptanceRate: w.acceptance,
    score: Math.round(w.score),
    periodDays: SPOTLIGHT_DAYS,
    rule: SPOTLIGHT_RULE,
  };
}
