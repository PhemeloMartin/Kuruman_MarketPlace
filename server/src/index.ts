import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import "dotenv/config";
import { pool } from "./db";

const app = express();
const PORT = Number(process.env.PORT) || 4000;

// Only our own client (the React app) may call this API from a browser.
app.use(cors({ origin: process.env.CLIENT_ORIGIN || "http://localhost:5173" }));
app.use(express.json());

// Quick check that the API and the database are both up.
app.get("/api/health", async (_req, res) => {
  const r = await pool.query("SELECT now() AS time");
  res.json({ status: "ok", database: "connected", time: r.rows[0].time });
});

app.get("/api/categories", async (_req, res) => {
  const r = await pool.query("SELECT id, slug, name FROM categories ORDER BY name");
  res.json(r.rows);
});

// Active products from active businesses. Optional filter: ?category=bakery
app.get("/api/products", async (req, res) => {
  const category = typeof req.query.category === "string" ? req.query.category : null;
  const r = await pool.query(
    `SELECT p.id, p.name, p.description, p.unit_label, p.price_cents, p.image_url,
            (p.stock_qty - p.reserved_qty) AS available_qty,
            c.slug AS category, b.id AS business_id, b.name AS business_name, b.area
       FROM products p
       JOIN categories c ON c.id = p.category_id
       JOIN businesses b ON b.id = p.business_id
      WHERE p.is_active AND b.is_active
        AND ($1::text IS NULL OR c.slug = $1)
      ORDER BY p.name`,
    [category]
  );
  res.json(r.rows);
});

app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

// Express 5 passes errors from async routes here automatically.
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "Something went wrong on the server." });
});

app.listen(PORT, () => {
  console.log(`KurumanMarketPlace API running on http://localhost:${PORT}`);
});
