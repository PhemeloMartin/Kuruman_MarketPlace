import { Router } from "express";
import { pool } from "../db";
import { publicReviews, ratingOf } from "../lib/reviews";
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
  b.id AS business_id, b.name AS business_name, b.area, b.own_delivery_fee_cents`;

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
    },
  };
}

// GET /api/products?category=bakery&q=bread
catalogueRouter.get("/products", async (req, res) => {
  const category = typeof req.query.category === "string" && req.query.category ? req.query.category : null;
  const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 80) : "";
  // Escape % and _ so a search for "50%" is taken literally.
  const pattern = q ? `%${q.replace(/[\\%_]/g, "\\$&")}%` : null;

  const r = await pool.query(
    `SELECT ${PRODUCT_COLUMNS}
       FROM products p
       JOIN categories c ON c.id = p.category_id
       JOIN businesses b ON b.id = p.business_id
      WHERE p.is_active AND b.is_active
        AND ($1::text IS NULL OR c.slug = $1)
        AND ($2::text IS NULL OR p.name ILIKE $2 OR p.description ILIKE $2)
      ORDER BY p.name`,
    [category, pattern]
  );
  res.json(r.rows.map(toProduct));
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
  res.json({
    ...product,
    photos: photos.rows.map((p) => p.url),
    businessRating: await ratingOf(product.business.id),
    businessWhatsapp: wa.rows[0].whatsapp_phone,
  });
});

// GET /api/shops/:id - a shop's public page: who they are and everything they have on sale.
// Only public details: never the seller's phone number or pickup address (those are shared per order).
catalogueRouter.get("/shops/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(404).json({ error: "Shop not found." });
  const b = await pool.query(
    `SELECT id, name, description, area, cover_photo_url, whatsapp_phone, own_delivery_fee_cents, own_delivery_note, created_at
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
    products: products.rows.map(toProduct),
    rating: await ratingOf(id),
    reviews: await publicReviews(id),
    isSpotlight: spotlight?.business.id === id,
  });
});

// GET /api/spotlight - this month's Entrepreneur of the Month (null if no shop qualifies yet).
catalogueRouter.get("/spotlight", async (_req, res) => {
  res.json({ spotlight: await currentSpotlight() });
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
