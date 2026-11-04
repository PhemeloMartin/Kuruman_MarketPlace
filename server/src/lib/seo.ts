import { pool } from "../db";

// Search engines (Google, Bing). They read three things from us:
//   /robots.txt  - which pages they may visit (public pages yes; carts, orders and dashboards no)
//   /sitemap.xml - every public page: home, directory, each shop and each product on sale
//   <link rel="canonical"> - the one address a page should be listed under. The same site also answers on
//                 its onrender.com address; without this, Google could list both as copies.

// The site's main address: the first one in CLIENT_ORIGIN (e.g. https://kurumanmarketplace.co.za).
export function canonicalSiteUrl(): string {
  const first = process.env.CLIENT_ORIGIN?.split(",")[0]?.trim();
  return (first || process.env.PUBLIC_APP_URL || "http://localhost:5173").trim().replace(/\/$/, "");
}

const PRIVATE = ["/api/", "/seller", "/support", "/courier", "/cart", "/orders", "/profile", "/notifications", "/help", "/signin", "/register", "/demo/"];

export function robotsTxt(): string {
  return ["User-agent: *", ...PRIVATE.map((p) => `Disallow: ${p}`), "", `Sitemap: ${canonicalSiteUrl()}/sitemap.xml`, ""].join("\n");
}

// Public page addresses that get a canonical tag (the rest are private or have no content of their own).
const PUBLIC_PAGE = /^\/(directory|privacy|shop\/\d+|product\/\d+)?$/;

export function canonicalTag(path: string): string {
  return PUBLIC_PAGE.test(path) ? `<link rel="canonical" href="${canonicalSiteUrl()}${path === "/" ? "/" : path}" />` : "";
}

export async function sitemapXml(): Promise<string> {
  const site = canonicalSiteUrl();
  const shops = await pool.query("SELECT id FROM businesses WHERE is_active ORDER BY id");
  const products = await pool.query(
    `SELECT p.id, p.updated_at FROM products p JOIN businesses b ON b.id = p.business_id
      WHERE p.is_active AND b.is_active ORDER BY p.id`
  );
  const url = (path: string, lastmod?: Date) =>
    `  <url><loc>${site}${path}</loc>${lastmod ? `<lastmod>${lastmod.toISOString().slice(0, 10)}</lastmod>` : ""}</url>`;
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    url("/"),
    url("/directory"),
    ...shops.rows.map((s) => url(`/shop/${s.id}`)),
    ...products.rows.map((p) => url(`/product/${p.id}`, p.updated_at)),
    "</urlset>",
    "",
  ].join("\n");
}
