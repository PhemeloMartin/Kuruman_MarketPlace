import { pool } from "../db";

// Link previews. When someone pastes a product or shop link into WhatsApp (or Facebook), WhatsApp
// fetches the page and looks for "Open Graph" tags to show a picture, a title and a line of text.
// It doesn't run our JavaScript, so the server writes those tags into the page itself.

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function siteUrl(): string {
  return (process.env.PUBLIC_APP_URL ?? process.env.CLIENT_ORIGIN?.split(",")[0] ?? "http://localhost:5173").trim();
}

function absolute(url: string | null): string {
  if (!url) return `${siteUrl()}/pwa-512.png`;
  return url.startsWith("http") ? url : `${siteUrl()}${url}`;
}

const rand = (cents: number) => `R${(cents / 100).toFixed(2)}`;

// Returns the <meta> tags for this page address, or "" for pages without their own preview.
export async function previewTags(path: string): Promise<string> {
  let title = "";
  let description = "";
  let image: string | null = null;

  const product = /^\/product\/(\d+)$/.exec(path);
  const shop = /^\/shop\/(\d+)$/.exec(path);
  if (product) {
    const r = await pool.query(
      `SELECT p.name, p.unit_label, p.price_cents, p.image_url, b.name AS shop, b.area
         FROM products p JOIN businesses b ON b.id = p.business_id
        WHERE p.id = $1 AND p.is_active AND b.is_active`,
      [Number(product[1])]
    );
    if (r.rowCount === 0) return "";
    const p = r.rows[0];
    title = `${p.name} - ${rand(p.price_cents)}`;
    description = `${p.unit_label} from ${p.shop}, ${p.area}. Order on KurumanMarketPlace: collect it or get it delivered.`;
    image = p.image_url;
  } else if (shop) {
    const r = await pool.query("SELECT name, area, description, cover_photo_url FROM businesses WHERE id = $1 AND is_active", [Number(shop[1])]);
    if (r.rowCount === 0) return "";
    const b = r.rows[0];
    title = `${b.name} on KurumanMarketPlace`;
    description = b.description ?? `A local shop in ${b.area}, Kuruman. See everything they sell and order online.`;
    image = b.cover_photo_url;
  } else {
    return "";
  }

  const tags = {
    "og:type": "website",
    "og:site_name": "KurumanMarketPlace",
    "og:title": title,
    "og:description": description.slice(0, 200),
    "og:image": absolute(image),
    "og:url": `${siteUrl()}${path}`,
  };
  return (
    Object.entries(tags)
      .map(([k, v]) => `<meta property="${k}" content="${escapeHtml(v)}" />`)
      .join("\n    ") + `\n    <title>${escapeHtml(title)}</title>`
  );
}

// Puts the tags into the page's <head>, replacing the default <title>.
export function withPreview(html: string, tags: string): string {
  if (!tags) return html;
  return html.replace(/<title>[^<]*<\/title>/, "").replace("</head>", `    ${tags}\n  </head>`);
}
