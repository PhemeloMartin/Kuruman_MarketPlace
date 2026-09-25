import { Router } from "express";
import { pool } from "../db";

// Public catalogue: anyone can browse without signing in (spec FR-01, FR-04).
// Only public fields are returned - never seller phone numbers or stock internals.
export const catalogueRouter = Router();

catalogueRouter.get("/categories", async (_req, res) => {
  const r = await pool.query("SELECT id, slug, name FROM categories ORDER BY name");
  res.json(r.rows.map((c) => ({ ...c, id: Number(c.id) })));
});

const PRODUCT_COLUMNS = `
  p.id, p.name, p.description, p.unit_label, p.price_cents, p.image_url,
  (p.stock_qty - p.reserved_qty) AS available_qty,
  c.slug AS category, c.name AS category_name,
  b.id AS business_id, b.name AS business_name, b.area`;

function toProduct(row: any) {
  return {
    id: Number(row.id),
    name: row.name,
    description: row.description,
    unitLabel: row.unit_label,
    priceCents: row.price_cents,
    imageUrl: row.image_url,
    availableQty: row.available_qty,
    category: row.category,
    categoryName: row.category_name,
    business: { id: Number(row.business_id), name: row.business_name, area: row.area },
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
  res.json(toProduct(r.rows[0]));
});
