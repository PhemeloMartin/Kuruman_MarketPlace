import { Router } from "express";
import { pool } from "../db";
import { requireStaff } from "../auth/session";
import { currentSpotlight } from "../lib/spotlight";

// The weekly post for the KurumanMarketPlace WhatsApp Channel: WhatsApp is where Kuruman FINDS the shops,
// the site is where it BUYS. Every line links back to the site. Support copies it into the channel by hand
// (WhatsApp Channels have no posting API for small organisations) - nothing is sent automatically.
export const whatsappPostRouter = Router();

function siteUrl(): string {
  return (process.env.PUBLIC_APP_URL ?? process.env.CLIENT_ORIGIN?.split(",")[0] ?? "http://localhost:5173").trim();
}

const rand = (cents: number) => `R${(cents / 100).toFixed(2).replace(/\.00$/, "")}`;

whatsappPostRouter.get("/support/whatsapp-post", requireStaff(), async (_req, res) => {
  const site = siteUrl();
  const newShops = await pool.query(
    "SELECT id, name, area FROM businesses WHERE is_active AND created_at > now() - interval '7 days' ORDER BY created_at DESC LIMIT 5"
  );
  const popular = await pool.query(
    `SELECT p.id, p.name, p.price_cents, b.name AS shop, sum(i.quantity)::int AS sold
       FROM order_items i
       JOIN orders o ON o.id = i.order_id AND o.status = 'completed' AND o.updated_at > now() - interval '7 days'
       JOIN products p ON p.id = i.product_id AND p.is_active
       JOIN businesses b ON b.id = p.business_id AND b.is_active
      GROUP BY p.id, b.name ORDER BY sold DESC LIMIT 3`
  );
  const stalls = await pool.query(
    "SELECT id, name, stall_location FROM businesses WHERE is_active AND kind = 'market_stall' ORDER BY id LIMIT 3"
  );
  const services = await pool.query(
    "SELECT name, category FROM directory_listings WHERE status = 'approved' AND decided_at > now() - interval '7 days' ORDER BY decided_at DESC LIMIT 3"
  );
  const spotlight = await currentSpotlight();

  const lines: string[] = ["*This week on KurumanMarketPlace* 🛒", "Buy local. Support Kuruman.", ""];
  if (spotlight) {
    lines.push(
      `🏆 *Entrepreneur of the Month:* ${spotlight.business.name} (${spotlight.business.area}) - ${spotlight.completedOrders} orders, ${spotlight.averageRating.toFixed(1)}★`,
      `${site}/shop/${spotlight.business.id}`,
      ""
    );
  }
  if (newShops.rowCount) {
    lines.push("🆕 *New shops*");
    for (const s of newShops.rows) lines.push(`• ${s.name}, ${s.area}: ${site}/shop/${s.id}`);
    lines.push("");
  }
  if (popular.rowCount) {
    lines.push("🔥 *Popular this week*");
    for (const p of popular.rows) lines.push(`• ${p.name} ${rand(p.price_cents)} from ${p.shop}: ${site}/product/${p.id}`);
    lines.push("");
  }
  if (stalls.rowCount) {
    lines.push("🧺 *Market stalls* - reserve online, collect and pay at the stall");
    for (const s of stalls.rows) lines.push(`• ${s.name}, ${s.stall_location}: ${site}/shop/${s.id}`);
    lines.push("");
  }
  if (services.rowCount) {
    lines.push("🛠 *New in the Business Directory*");
    for (const s of services.rows) lines.push(`• ${s.name}`);
    lines.push(`${site}/directory`, "");
  }
  lines.push(
    "✅ Pay only after the seller accepts. A handover code protects every order.",
    "Order on the site, not by private payment, so your money is protected.",
    site
  );
  res.json({ text: lines.join("\n") });
});
