import { Router } from "express";
import { pool } from "../db";
import { expandQuery, plain } from "../lib/glossary";
import { publicReviews, ratingOf, themeCounts } from "../lib/reviews";
import { currentSpotlight } from "../lib/spotlight";

// Public catalogue: anyone can browse without signing in (spec FR-01, FR-04).
// Only public fields are returned - never seller phone numbers or stock internals.
export const catalogueRouter = Router();

// Each category comes with how many products are on sale in it, so the Home screen's
// "Shop by market" tiles can say "12 items" or "Coming soon". Same visibility rule as /products.
catalogueRouter.get("/categories", async (_req, res) => {
  const r = await pool.query(
    `SELECT c.id, c.slug, c.name, COUNT(p.id) AS product_count
       FROM categories c
       LEFT JOIN products p ON p.category_id = c.id AND p.is_active
            AND EXISTS (SELECT 1 FROM businesses b WHERE b.id = p.business_id AND b.is_active)
      GROUP BY c.id
      ORDER BY c.name`
  );
  res.json(r.rows.map((c) => ({ id: Number(c.id), slug: c.slug, name: c.name, productCount: Number(c.product_count) })));
});

const PRODUCT_COLUMNS = `
  p.id, p.name, p.description, p.unit_label, p.price_cents, p.image_url, p.collection_only,
  (p.stock_qty - p.reserved_qty) AS available_qty,
  c.slug AS category, c.name AS category_name,
  b.id AS business_id, b.name AS business_name, b.area, b.own_delivery_fee_cents, b.kind`;

function toProduct(row: any) {
  return {
    id: Number(row.id),
    name: row.name,
    description: row.description,
    unitLabel: row.unit_label,
    priceCents: row.price_cents,
    imageUrl: row.image_url,
    collectionOnly: row.collection_only,
    availableQty: row.available_qty,
    category: row.category,
    categoryName: row.category_name,
    business: {
      id: Number(row.business_id),
      name: row.business_name,
      area: row.area,
      ownDeliveryFeeCents: row.own_delivery_fee_cents, // null = the shop doesn't deliver itself
      kind: row.kind, // 'shop' or 'market_stall'
    },
  };
}

// Search and browse. Words are widened with the multilingual glossary ("spinasie" also searches
// "spinach" and "sepinatšhe"), and close spellings of product names count too ("spinich" -> Spinach),
// using letter-trigram similarity in the database (pg_trgm). Exact word matches come first.
async function findProducts(category: string | null, q: string) {
  const { terms, matchedGroups } = q ? expandQuery(q) : { terms: [], matchedGroups: [] as string[][] };
  // Escape % and _ so a search for "50%" is taken literally.
  const patterns = terms.length ? terms.map((t) => `%${t.replace(/[\\%_]/g, "\\$&")}%`) : null;
  const r = await pool.query(
    `SELECT ${PRODUCT_COLUMNS}
       FROM products p
       JOIN categories c ON c.id = p.category_id
       JOIN businesses b ON b.id = p.business_id
      WHERE p.is_active AND b.is_active
        AND ($1::text IS NULL OR c.slug = $1)
        AND ($2::text[] IS NULL
             OR lower(p.name) LIKE ANY($2) OR lower(coalesce(p.description, '')) LIKE ANY($2)
             OR similarity(lower(p.name), $3) >= 0.3 OR word_similarity($3, lower(p.name)) >= 0.6)
      ORDER BY ($2::text[] IS NOT NULL AND lower(p.name) LIKE ANY($2)) DESC,
               similarity(lower(p.name), coalesce($3, '')) DESC, p.name`,
    [category, patterns, q ? plain(q) : null]
  );
  const typed = plain(q);
  return {
    products: r.rows.map(toProduct),
    // Other words searched too, to show "Also searched: spinach, sepinatšhe".
    alsoSearched: [...new Set(matchedGroups.flat())].filter((w) => plain(w) !== typed).slice(0, 6),
  };
}

// GET /api/products?category=bakery&q=bread - the product list (also saved for offline browsing).
catalogueRouter.get("/products", async (req, res) => {
  const category = typeof req.query.category === "string" && req.query.category ? req.query.category : null;
  const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 80) : "";
  res.json((await findProducts(category, q)).products);
});

// GET /api/search?q=spinasie&category=... - the same, plus which other words were searched.
catalogueRouter.get("/search", async (req, res) => {
  const category = typeof req.query.category === "string" && req.query.category ? req.query.category : null;
  const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 80) : "";
  res.json(await findProducts(category, q));
});

catalogueRouter.get("/products/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(404).json({ error: "Product not found." });

  const r = await pool.query(
    `SELECT ${PRODUCT_COLUMNS}
       FROM products p
       JOIN categories c ON c.id = p.category_id
       JOIN businesses b ON b.id = p.business_id
      WHERE p.id = $1 AND p.is_active AND b.is_active`,
    [id]
  );
  if (r.rowCount === 0) return res.status(404).json({ error: "Product not found." });
  const photos = await pool.query("SELECT url FROM photos WHERE product_id = $1 ORDER BY sort_order, id", [id]);
  const product = toProduct(r.rows[0]);
  const wa = await pool.query("SELECT whatsapp_phone FROM businesses WHERE id = $1", [product.business.id]);
  const voice = await pool.query("SELECT duration_seconds, created_at FROM voice_notes WHERE product_id = $1", [id]);
  res.json({
    ...product,
    photos: photos.rows.map((p) => p.url),
    businessRating: await ratingOf(product.business.id),
    businessWhatsapp: wa.rows[0].whatsapp_phone,
    voiceNote: voice.rowCount
      ? { url: `/api/voice/${id}?v=${new Date(voice.rows[0].created_at).getTime()}`, seconds: voice.rows[0].duration_seconds }
      : null,
  });
});

// GET /api/shops/:id - a shop's public page: who they are and everything they have on sale.
// Only public details: never the seller's phone number or pickup address (those are shared per order).
catalogueRouter.get("/shops/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(404).json({ error: "Shop not found." });
  const b = await pool.query(
    `SELECT id, name, description, area, cover_photo_url, whatsapp_phone, own_delivery_fee_cents, own_delivery_note, created_at,
            calls_enabled,
            kind, stall_location, stall_days, to_char(stall_opens, 'HH24:MI') AS opens, to_char(stall_closes, 'HH24:MI') AS closes,
            -- "Here today": today (South African time) is a stall day and it's within opening hours.
            (kind = 'market_stall'
             AND EXTRACT(ISODOW FROM now() AT TIME ZONE 'Africa/Johannesburg')::int = ANY(stall_days)
             AND (now() AT TIME ZONE 'Africa/Johannesburg')::time BETWEEN stall_opens AND stall_closes) AS here_now
       FROM businesses WHERE id = $1 AND is_active`,
    [id]
  );
  if (b.rowCount === 0) return res.status(404).json({ error: "Shop not found." });
  const products = await pool.query(
    `SELECT ${PRODUCT_COLUMNS}
       FROM products p
       JOIN categories c ON c.id = p.category_id
       JOIN businesses b ON b.id = p.business_id
      WHERE p.business_id = $1 AND p.is_active
      ORDER BY p.name`,
    [id]
  );
  const shop = b.rows[0];
  const spotlight = await currentSpotlight();
  res.json({
    id: Number(shop.id),
    name: shop.name,
    description: shop.description,
    area: shop.area,
    coverPhotoUrl: shop.cover_photo_url,
    sellingSince: shop.created_at,
    whatsapp: shop.whatsapp_phone, // only set if the seller chose to show it
    ownDeliveryFeeCents: shop.own_delivery_fee_cents,
    ownDeliveryNote: shop.own_delivery_note,
    callsEnabled: shop.calls_enabled,
    kind: shop.kind,
    stall:
      shop.kind === "market_stall"
        ? { location: shop.stall_location, days: shop.stall_days ?? [], opens: shop.opens, closes: shop.closes, hereNow: Boolean(shop.here_now) }
        : null,
    products: products.rows.map(toProduct),
    rating: await ratingOf(id),
    reviews: await publicReviews(id),
    customerThemes: await themeCounts(id),
    isSpotlight: spotlight?.business.id === id,
  });
});

// GET /api/spotlight - this month's Entrepreneur of the Month (null if no shop qualifies yet).
catalogueRouter.get("/spotlight", async (_req, res) => {
  res.json({ spotlight: await currentSpotlight() });
});

// GET /api/voice/:productId - the product's voice note. The ?v= part changes with each new
// recording, so it can be cached like a photo.
catalogueRouter.get("/voice/:productId", async (req, res) => {
  const r = await pool.query(
    `SELECT v.data, v.content_type FROM voice_notes v JOIN products p ON p.id = v.product_id
      WHERE v.product_id = $1 AND p.is_active`,
    [Number(req.params.productId)]
  );
  if (r.rowCount === 0) return res.status(404).end();
  res.set("Cache-Control", "public, max-age=31536000, immutable");
  res.set("Content-Type", r.rows[0].content_type);
  res.set("X-Content-Type-Options", "nosniff");
  res.send(r.rows[0].data);
});

// GET /api/photos/:id - a photo kept in our own database (when Cloudinary isn't configured).
// A photo never changes once uploaded (a new one gets a new id), so browsers may keep it for a year.
catalogueRouter.get("/photos/:id", async (req, res) => {
  const id = Number(req.params.id);
  const r = Number.isInteger(id) && id > 0
    ? await pool.query("SELECT data, content_type FROM photos WHERE id = $1 AND storage = 'database'", [id])
    : { rowCount: 0, rows: [] as any[] };
  if (r.rowCount === 0) return res.status(404).end();
  res.set("Cache-Control", "public, max-age=31536000, immutable");
  res.set("Content-Type", r.rows[0].content_type);
  res.set("X-Content-Type-Options", "nosniff");
  res.send(r.rows[0].data);
});
