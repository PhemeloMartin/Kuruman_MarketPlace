import { pool } from "../db";

// Reviews come only from completed orders on the site (one per order), so a rating here means
// "people who really bought from this shop". Hidden reviews (removed by support) never count.

export const REVIEW_DAYS = 30; // how long after receiving an order you can still review it

export interface Rating {
  average: number | null; // 1 decimal, null when there are no reviews yet
  count: number;
}

export async function ratingOf(businessId: number): Promise<Rating> {
  const r = await pool.query(
    `SELECT round(avg(rating)::numeric, 1)::float AS average, count(*)::int AS count
       FROM reviews WHERE business_id = $1 AND hidden_at IS NULL`,
    [businessId]
  );
  return { average: r.rows[0].average, count: r.rows[0].count };
}

// Shown on the shop page. Only the reviewer's first name: enough to feel personal, not enough to
// identify them (POPIA minimum disclosure). A closed account shows as "A customer".
export async function publicReviews(businessId: number, limit = 20) {
  const r = await pool.query(
    `SELECT rv.id, rv.rating, rv.comment, rv.seller_reply, rv.seller_replied_at, rv.created_at, rv.themes,
            CASE WHEN u.closed_at IS NULL THEN split_part(u.display_name, ' ', 1) ELSE 'A customer' END AS first_name
       FROM reviews rv JOIN users u ON u.id = rv.consumer_id
      WHERE rv.business_id = $1 AND rv.hidden_at IS NULL
      ORDER BY rv.created_at DESC
      LIMIT $2`,
    [businessId, limit]
  );
  return r.rows.map((x) => ({
    id: Number(x.id),
    rating: x.rating,
    comment: x.comment,
    firstName: x.first_name,
    createdAt: x.created_at,
    sellerReply: x.seller_reply,
    sellerRepliedAt: x.seller_replied_at,
    themes: x.themes,
  }));
}

export function cleanText(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().replace(/\s+\n/g, "\n").slice(0, max) : "";
}
