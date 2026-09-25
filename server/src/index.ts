import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import "dotenv/config";
import { pool } from "./db";
import { loadSession } from "./auth/session";
import { authRouter } from "./routes/auth";
import { catalogueRouter } from "./routes/catalogue";

const app = express();
const PORT = Number(process.env.PORT) || 4000;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "http://localhost:5173";

// Only our own client (the React app) may call this API from a browser.
app.use(cors({ origin: CLIENT_ORIGIN, credentials: true }));
app.use(express.json({ limit: "100kb" }));
app.use(cookieParser());

// CSRF defence for cookie logins: a browser always sends Origin on POST/PATCH/DELETE,
// so a request that changes data and comes from another website is refused.
app.use((req, res, next) => {
  const changesData = !["GET", "HEAD", "OPTIONS"].includes(req.method);
  const origin = req.get("origin");
  if (changesData && origin && origin !== CLIENT_ORIGIN) {
    return res.status(403).json({ error: "Request refused." });
  }
  next();
});

// Works out who is signed in (if anyone) for every request.
app.use(loadSession);

// Quick check that the API and the database are both up.
app.get("/api/health", async (_req, res) => {
  const r = await pool.query(
    "SELECT now() AS time, (SELECT count(*)::int FROM products WHERE is_active) AS product_count"
  );
  res.json({ status: "ok", databaseTime: r.rows[0].time, productCount: r.rows[0].product_count });
});

app.use("/api/auth", authRouter);
app.use("/api", catalogueRouter);

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
