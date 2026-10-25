// Tier 2 AI integration: review analysis, off-platform screening with support decisions, the sales
// forecast, multilingual search, and what happens when the AI service is down.
//
//   npm run test:ai
//
// The Python models are evaluated by their own training scripts (ai/train_*.py). This test checks the
// MARKETPLACE side, using a small fake AI service with fixed answers, so no Python is needed.
// It adds data: run `npm run db:setup` and `npm run db:seed` afterwards.

import http from "http";
import assert from "assert/strict";
import { AddressInfo } from "net";
import { app } from "../app";
import { pool } from "../db";
import { runAiWorker } from "../lib/aiWorker";
import { currentStep, totpCode } from "../lib/totp";

// A fake AI service: flags texts mentioning eWallet; reviews mentioning "cold" are negative.
const fake = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    if (req.headers["x-ai-token"] !== "fake-token") return void res.writeHead(401).end();
    const data = JSON.parse(body || "{}");
    const send = (x: unknown) => res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(x));
    if (req.url === "/reviews/analyse") {
      return send({
        modelVersion: "fake-reviews",
        results: data.texts.map((t: string) =>
          /cold/i.test(t) ? { sentiment: "negative", themes: ["cold"] } : { sentiment: "positive", themes: ["fresh"] }
        ),
      });
    }
    if (req.url === "/screen") {
      const flag = /ewallet/i.test(data.text);
      return send({ flag, score: flag ? 0.95 : 0.1, reasons: flag ? ["model"] : [], modelVersion: "fake-screening" });
    }
    if (req.url === "/forecast") {
      const enough = data.history.length >= 28;
      return send({ enough, modelVersion: "fake-forecast", forecast: enough ? [{ date: "2026-11-07", units: 12 }, { date: "2026-11-08", units: 4 }] : undefined });
    }
    res.writeHead(404).end();
  });
});

async function main() {
  await new Promise<void>((r) => fake.listen(0, r));
  process.env.AI_SERVICE_URL = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`;
  process.env.AI_SERVICE_TOKEN = "fake-token"; // the AI client reads these when it calls, not at import

  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const ORIGIN = "http://localhost:5173";
  let passed = 0;

  async function call(cookie: string, method: string, path: string, body?: unknown) {
    const res = await fetch(base + path, {
      method,
      headers: { Origin: ORIGIN, Cookie: cookie, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    return { status: res.status, data: text ? JSON.parse(text) : null };
  }
  async function login(phone: string) {
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

  try {
    console.log("\nTier 2 AI integration tests\n");
    const support = await login("0710000004");
    const setup = await call(support, "POST", "/api/support/mfa/setup");
    assert.equal((await call(support, "POST", "/api/support/mfa/verify", { code: totpCode(setup.data.secret, currentStep()) })).status, 200);
    const kgomotso = await login("0710000002");
    const spinach = (await pool.query("SELECT id FROM products WHERE name = 'Spinach bunch'")).rows[0].id;

    await check("the AI worker reads new reviews: sentiment and themes are saved with the model version", async () => {
      await pool.query("UPDATE reviews SET comment = 'Food was cold' WHERE id = (SELECT min(id) FROM reviews)");
      await runAiWorker();
      const r = (await pool.query("SELECT sentiment, themes, ai_model_version FROM reviews WHERE id = (SELECT min(id) FROM reviews)")).rows[0];
      assert.equal(r.sentiment, "negative");
      assert.deepEqual(r.themes, ["cold"]);
      assert.equal(r.ai_model_version, "fake-reviews");
    });

    await check("the shop page summarises themes: 'Customers mention ...'", async () => {
      const biz = (await pool.query("SELECT business_id FROM reviews WHERE id = (SELECT min(id) FROM reviews)")).rows[0].business_id;
      const shop = (await call("", "GET", `/api/shops/${biz}`)).data;
      assert.ok(shop.customerThemes.some((t: any) => t.theme === "cold" && t.count >= 1));
    });

    await check("a description asking for eWallet payment is flagged for support - and NOT hidden automatically", async () => {
      await call(kgomotso, "PATCH", `/api/seller/products/${spinach}`, { description: "Pay me by eWallet first, then collect" });
      await runAiWorker();
      const flags = (await call(support, "GET", "/api/support/ops/flags")).data;
      const f = flags.find((x: any) => x.itemType === "product" && x.itemId === Number(spinach));
      assert.ok(f, "flagged");
      assert.match(f.excerpt, /eWallet/);
      const p = (await pool.query("SELECT is_active FROM products WHERE id = $1", [spinach])).rows[0];
      assert.equal(p.is_active, true, "still on sale until a person decides");
    });

    await check("each version of a text is screened once; an edit is screened again", async () => {
      const before = Number((await pool.query("SELECT count(*) FROM screenings WHERE item_type = 'product' AND item_id = $1", [spinach])).rows[0].count);
      await runAiWorker();
      const same = Number((await pool.query("SELECT count(*) FROM screenings WHERE item_type = 'product' AND item_id = $1", [spinach])).rows[0].count);
      assert.equal(same, before);
      await call(kgomotso, "PATCH", `/api/seller/products/${spinach}`, { description: "Fresh from the garden" });
      await runAiWorker();
      const after = Number((await pool.query("SELECT count(*) FROM screenings WHERE item_type = 'product' AND item_id = $1", [spinach])).rows[0].count);
      assert.equal(after, before + 1);
    });

    await check("support decides with a reason: 'take off sale' hides it and is in the audit log", async () => {
      const flag = (await call(support, "GET", "/api/support/ops/flags")).data.find((x: any) => x.itemId === Number(spinach));
      assert.equal((await call(support, "POST", `/api/support/ops/flags/${flag.id}`, { decision: "hide" })).status, 422, "reason needed");
      const r = await call(support, "POST", `/api/support/ops/flags/${flag.id}`, { decision: "hide", reason: "Asks for payment outside the site." });
      assert.equal(r.status, 200);
      assert.equal((await pool.query("SELECT is_active FROM products WHERE id = $1", [spinach])).rows[0].is_active, false);
      const log = await pool.query("SELECT 1 FROM audit_events WHERE action = 'screening.hide' AND resource_id = $1", [String(spinach)]);
      assert.equal(log.rowCount, 1);
      assert.equal((await call(support, "POST", `/api/support/ops/flags/${flag.id}`, { decision: "dismiss", reason: "Again" })).status, 409);
    });

    await check("sellers can't see or decide flags", async () => {
      assert.equal((await call(kgomotso, "GET", "/api/support/ops/flags")).status, 403);
    });

    await check("the forecast uses the shop's own daily sales (weeks of history needed)", async () => {
      const dineo = await login("0710000010");
      const f = (await call(dineo, "GET", "/api/seller/forecast")).data;
      assert.equal(f.available, true);
      assert.equal(f.modelVersion, "fake-forecast");
      const kota = f.products.find((p: any) => p.name.startsWith("Kota"));
      assert.equal(kota.enoughHistory, true);
      assert.ok(kota.weeksOfHistory >= 4);
      assert.equal(kota.nextWeekTotal, 16);
      assert.equal(kota.busiestDay.units, 12);
    });

    await check("multilingual search: Setswana, Afrikaans and a typo all find the spinach", async () => {
      await pool.query("UPDATE products SET is_active = TRUE WHERE id = $1", [spinach]);
      for (const q of ["sepinatshe", "spinasie", "spinich"]) {
        const r = (await call("", "GET", `/api/search?q=${q}`)).data;
        assert.ok(r.products.some((p: any) => p.name === "Spinach bunch"), q);
      }
      const r = (await call("", "GET", "/api/search?q=spinasie")).data;
      assert.ok(r.alsoSearched.includes("spinach"));
    });

    await check("if the AI service is down, nothing breaks: no forecast card, the worker waits", async () => {
      process.env.AI_SERVICE_URL = "http://127.0.0.1:9"; // nothing listens there
      const dineo = await login("0710000010");
      assert.deepEqual((await call(dineo, "GET", "/api/seller/forecast")).data, { available: false, products: [] });
      const n = await runAiWorker();
      assert.equal(n.screened, 0);
      assert.equal((await call("", "GET", "/api/search?q=spinach")).status, 200, "search doesn't need the AI service");
    });

    console.log(`\n${passed} checks passed.\n`);
  } finally {
    server.close();
    fake.close();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("\nFAILED:", err);
  process.exitCode = 1;
});
