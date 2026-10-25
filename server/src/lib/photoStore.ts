import crypto from "crypto";
import type { PoolClient } from "pg";

// Stores product and shop photos.
//
// With CLOUDINARY_URL set (cloudinary://API_KEY:API_SECRET@CLOUD_NAME, from the Cloudinary
// dashboard), photos go to Cloudinary, an image service: they're served from fast servers near the
// viewer and resized for each screen. Without it (on a laptop, in the tests) the image is kept in our
// own database and served by GET /api/photos/:id. Either way the rest of the app only sees a URL.
//
// The browser has already shrunk the photo (about 1200 px, ~100-200 KB) before uploading it.

export const MAX_PHOTO_BYTES = 2 * 1024 * 1024;

type Cloudinary = { cloud: string; key: string; secret: string };

function cloudinaryConfig(): Cloudinary | null {
  const m = /^cloudinary:\/\/([^:]+):([^@]+)@(.+)$/.exec(process.env.CLOUDINARY_URL ?? "");
  return m ? { key: m[1], secret: m[2], cloud: m[3] } : null;
}

// Checks the first bytes of the file, not just what the browser claims it is: a file called
// "photo.jpg" that is really something else is refused.
export function detectImageType(buf: Buffer): "image/jpeg" | "image/png" | "image/webp" | null {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.length > 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return null;
}

// Cloudinary's signed-request rule: the parameters in alphabetical order, then the secret, SHA-1.
function sign(params: Record<string, string>, secret: string): string {
  const text = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");
  return crypto.createHash("sha1").update(text + secret).digest("hex");
}

async function cloudinaryCall(cfg: Cloudinary, action: "upload" | "destroy", params: Record<string, string>, file?: Buffer, type?: string) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signed = { ...params, timestamp };
  const form = new FormData();
  for (const [k, v] of Object.entries(signed)) form.append(k, v);
  form.append("api_key", cfg.key);
  form.append("signature", sign(signed, cfg.secret));
  if (file) form.append("file", `data:${type};base64,${file.toString("base64")}`);
  const res = await fetch(`https://api.cloudinary.com/v1_1/${cfg.cloud}/image/${action}`, { method: "POST", body: form });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Cloudinary ${action} failed: ${data?.error?.message ?? res.status}`);
  return data;
}

// Saves one photo and returns its new row id and the URL pages should show.
export async function savePhoto(
  client: PoolClient,
  owner: { businessId: number; productId: number | null },
  image: Buffer,
  type: string,
  sortOrder: number
): Promise<{ id: number; url: string }> {
  const cfg = cloudinaryConfig();
  if (cfg) {
    const up = await cloudinaryCall(cfg, "upload", { folder: `kurumanmarketplace/shop-${owner.businessId}` }, image, type);
    // "f_auto,q_auto,w_1000": Cloudinary picks the best format and quality for each phone, at most 1000 px wide.
    const url = String(up.secure_url).replace("/upload/", "/upload/f_auto,q_auto,w_1000/");
    const r = await client.query(
      `INSERT INTO photos (business_id, product_id, storage, url, storage_key, content_type, bytes, sort_order)
       VALUES ($1, $2, 'cloudinary', $3, $4, $5, $6, $7) RETURNING id`,
      [owner.businessId, owner.productId, url, up.public_id, type, image.length, sortOrder]
    );
    return { id: Number(r.rows[0].id), url };
  }

  const r = await client.query(
    `INSERT INTO photos (business_id, product_id, storage, data, content_type, bytes, sort_order)
     VALUES ($1, $2, 'database', $3, $4, $5, $6) RETURNING id`,
    [owner.businessId, owner.productId, image, type, image.length, sortOrder]
  );
  const id = Number(r.rows[0].id);
  const url = `/api/photos/${id}`;
  await client.query("UPDATE photos SET url = $2 WHERE id = $1", [id, url]);
  return { id, url };
}

// Removes the image from Cloudinary too. Called after the database row is gone; if Cloudinary is
// unreachable the photo is only orphaned there (logged), never shown again on our site.
export async function deleteStoredImage(storage: string, storageKey: string | null): Promise<void> {
  const cfg = cloudinaryConfig();
  if (storage !== "cloudinary" || !storageKey || !cfg) return;
  try {
    await cloudinaryCall(cfg, "destroy", { public_id: storageKey });
  } catch (err: any) {
    console.warn(`Photo ${storageKey} not removed from Cloudinary: ${err?.message ?? err}`);
  }
}
