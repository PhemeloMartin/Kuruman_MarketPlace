// Product and shop photos: who may upload, what counts as a photo, limits, and the public pages.
//
//   npm run test:photos
//
// Runs without Cloudinary (photos are kept in the database), so it needs no internet.
// It adds photos to the demo shops: run `npm run db:setup` and `npm run db:seed` afterwards.

delete process.env.CLOUDINARY_URL;

import assert from "assert/strict";
import { AddressInfo } from "net";
import { app } from "../app";
import { pool } from "../db";

const ORIGIN = "http://localhost:5173";
let base = "";
let passed = 0;

// A real 1 x 1 pixel PNG image.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

async function call(cookie: string, method: string, path: string, body?: unknown, type?: string) {
  const raw = Buffer.isBuffer(body);
  const res = await fetch(base + path, {
    method,
    headers: {
      Origin: ORIGIN,
      Cookie: cookie,
      ...(body !== undefined ? { "Content-Type": type ?? (raw ? "image/png" : "application/json") } : {}),
    },
    body: body === undefined ? undefined : raw ? new Uint8Array(body as Buffer) : JSON.stringify(body),
  });
  const buf = Buffer.from(await res.arrayBuffer());
  let data: any = null;
  try {
    data = JSON.parse(buf.toString("utf8"));
  } catch {}
  return { status: res.status, data, buf, headers: res.headers };
}

async function login(phone: string): Promise<string> {
  const r = await fetch(base + "/api/auth/login", {
    method: "POST",
    headers: { Origin: ORIGIN, "Content-Type": "application/json" },
    body: JSON.stringify({ phone, passphrase: process.env.SEED_PASSPHRASE || "Kuruman Oasis 2026" }),
  });
  assert.equal(r.status, 200, `login ${phone}`);
  return r.headers.get("set-cookie")!.split(";")[0];
}

async function check(name: string, fn: () => Promise<void>) {
  await fn();
  passed++;
  console.log(`  PASS  ${name}`);
}

async function main() {
  const server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  try {
    console.log("\nPhoto tests\n");
    const kgomotso = await login("0710000002"); // owns products 1-6
    const naledi = await login("0710000005"); // another seller
    const thato = await login("0710000001"); // a customer
    const productId = 1;

    let firstUrl = "";
    await check("a seller adds a photo to their own product; it becomes the product's picture", async () => {
      const r = await call(kgomotso, "POST", `/api/seller/photos?productId=${productId}`, PNG);
      assert.equal(r.status, 201);
      firstUrl = r.data.url;
      const p = await call("", "GET", `/api/products/${productId}`);
      assert.equal(p.data.imageUrl, firstUrl);
      assert.deepEqual(p.data.photos, [firstUrl]);
    });

    await check("anyone can load the photo, as an image the browser may keep for a year", async () => {
      const r = await call("", "GET", firstUrl);
      assert.equal(r.status, 200);
      assert.equal(r.headers.get("content-type"), "image/png");
      assert.match(r.headers.get("cache-control") ?? "", /immutable/);
      assert.ok(r.buf.equals(PNG));
    });

    await check("a file that only claims to be a photo is refused (the first bytes are checked)", async () => {
      const fake = Buffer.from("<script>alert(1)</script> not a picture");
      const r = await call(kgomotso, "POST", `/api/seller/photos?productId=${productId}`, fake, "image/jpeg");
      assert.equal(r.status, 422);
    });

    await check("another seller can't add photos to this product, and customers can't upload at all", async () => {
      assert.equal((await call(naledi, "POST", `/api/seller/photos?productId=${productId}`, PNG)).status, 404);
      assert.equal((await call(thato, "POST", `/api/seller/photos?productId=${productId}`, PNG)).status, 403);
    });

    await check("at most 5 photos per product", async () => {
      for (let i = 0; i < 4; i++) assert.equal((await call(kgomotso, "POST", `/api/seller/photos?productId=${productId}`, PNG)).status, 201);
      const sixth = await call(kgomotso, "POST", `/api/seller/photos?productId=${productId}`, PNG);
      assert.equal(sixth.status, 409);
    });

    await check("'make main photo' changes the product's picture", async () => {
      const list = (await call(kgomotso, "GET", `/api/seller/products/${productId}/photos`)).data;
      const last = list[list.length - 1];
      assert.equal((await call(kgomotso, "POST", `/api/seller/photos/${last.id}/main`)).status, 204);
      assert.equal((await call("", "GET", `/api/products/${productId}`)).data.imageUrl, last.url);
    });

    await check("deleting a photo removes it everywhere, and only the owner can delete", async () => {
      const list = (await call(kgomotso, "GET", `/api/seller/products/${productId}/photos`)).data;
      assert.equal((await call(naledi, "DELETE", `/api/seller/photos/${list[0].id}`)).status, 404);
      for (const ph of list) assert.equal((await call(kgomotso, "DELETE", `/api/seller/photos/${ph.id}`)).status, 204);
      const p = await call("", "GET", `/api/products/${productId}`);
      assert.equal(p.data.imageUrl, null);
      assert.equal((await call("", "GET", list[0].url)).status, 404);
    });

    await check("a new cover photo replaces the old one", async () => {
      const a = await call(kgomotso, "POST", "/api/seller/photos?cover=1", PNG);
      const b = await call(kgomotso, "POST", "/api/seller/photos?cover=1", PNG);
      assert.equal((await call(kgomotso, "GET", "/api/seller/shop")).data.coverPhotoUrl, b.data.url);
      assert.equal((await call("", "GET", a.data.url)).status, 404);
    });

    await check("the public shop page shows the shop and its products - but no phone number or address", async () => {
      assert.equal((await call(kgomotso, "PATCH", "/api/seller/shop", { description: "Fresh from our garden in Wrenchville." })).status, 200);
      const shopId = (await call(kgomotso, "GET", "/api/seller/shop")).data.id;
      const r = await call("", "GET", `/api/shops/${shopId}`);
      assert.equal(r.status, 200);
      assert.equal(r.data.description, "Fresh from our garden in Wrenchville.");
      assert.ok(r.data.products.length > 0);
      const text = r.buf.toString("utf8");
      assert.ok(!text.includes("+2771") && !text.includes("pickup"), "no phone number or pickup address");
    });

    console.log(`\n${passed} checks passed.\n`);
  } finally {
    server.close();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("\nFAILED:", err);
  process.exitCode = 1;
});
