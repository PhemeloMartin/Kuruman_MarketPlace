// The Express app: middleware and routes. index.ts starts it; tests can start their own copy.
import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import "dotenv/config";
import { pool } from "./db";
import { loadSession } from "./auth/session";
import { authRouter } from "./routes/auth";
import { catalogueRouter } from "./routes/catalogue";
import { ordersRouter } from "./routes/orders";
import { sellerRouter } from "./routes/seller";
import { courierRouter } from "./routes/courier";
import { paymentsRouter } from "./routes/payments";
import { applicationsRouter } from "./routes/applications";
import { supportRouter } from "./routes/support";
import { supportMoneyRouter } from "./routes/supportMoney";
import { supportOpsRouter } from "./routes/supportOps";
import { supportPrivacyRouter } from "./routes/supportPrivacy";
import { privacyRouter } from "./routes/privacy";
import { POLICY } from "./lib/policy";

export const app = express();
// Behind a tunnel or hosting proxy, the real caller's IP arrives in the X-Forwarded-For header
// (needed for Payfast's source-IP check). TRUST_PROXY is the NUMBER of proxies we run in front
// of the API (1 for the Cloudflare tunnel). Express then takes the address that our own proxy
// added and ignores anything further left, which a caller could have typed in themselves.
// Unset or 0 = no proxy: use the connection's own address.
app.set("trust proxy", Number(process.env.TRUST_PROXY) || false);
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

// Private answers (accounts, orders, addresses, payments) must never be stored by the browser
// or any cache in between (spec 5.4 "no-store"). Only the public catalogue may be cached.
const PUBLIC_API = /^\/api\/(products|categories|config|health)(\/|$|\?)/;
app.use("/api", (req, res, next) => {
  res.set("Cache-Control", req.method === "GET" && PUBLIC_API.test(req.originalUrl) ? "no-cache" : "no-store");
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

// Public policy values, so the website shows exactly what the server enforces.
app.get("/api/config", (_req, res) => {
  res.json(POLICY);
});

app.use("/api/auth", authRouter);
app.use("/api/orders", ordersRouter);
app.use("/api/seller", sellerRouter);
app.use("/api/courier", courierRouter);
app.use("/api/applications", applicationsRouter);
app.use("/api/support/money", supportMoneyRouter);
app.use("/api/support/ops", supportOpsRouter);
app.use("/api/support/privacy", supportPrivacyRouter);
app.use("/api/privacy", privacyRouter);
app.use("/api/support", supportRouter);
app.use("/api", paymentsRouter);
app.use("/api", catalogueRouter);

app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

// Express 5 passes errors from async routes here automatically.
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "Something went wrong on the server." });
});
