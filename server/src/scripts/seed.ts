import bcrypt from "bcryptjs";
import { pool } from "../db";
import { describeError } from "../lib/describeError";

// Synthetic demo data only - no real people or businesses.
// Every demo account uses the same passphrase so the demo is easy to run.
// It meets the 15-character minimum from spec section 7.3.
// On a HOSTED copy, set SEED_PASSPHRASE to a private one: this repository is public, so the
// default below is known to anyone - including for the support accounts.
const DEMO_PASSPHRASE = process.env.SEED_PASSPHRASE || "Kuruman Oasis 2026";
if (DEMO_PASSPHRASE.length < 15) throw new Error("SEED_PASSPHRASE must be at least 15 characters.");

async function main() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Categories ("markets" on the Home screen).
    // The first six are spec Table 34 - the labels the AI model predicts. The last four are the
    // wider Kuruman economy (building, livestock, farm, street food); the AI can't suggest them
    // yet, so sellers choose them by hand until the model is retrained with examples.
    const categories = [
      ["fresh-produce", "Fresh produce"],
      ["pantry", "Pantry & groceries"],
      ["clothing", "Clothing & accessories"],
      ["household", "Household"],
      ["crafts", "Crafts & gifts"],
      ["personal-care", "Personal care"],
      ["street-food", "Street food & caravans"],
      ["building", "Building materials"],
      ["livestock", "Livestock"],
      ["farm-feed", "Animal feed & farm supplies"],
    ];
    const categoryIds: Record<string, number> = {};
    for (const [slug, name] of categories) {
      const r = await client.query(
        "INSERT INTO categories (slug, name) VALUES ($1, $2) RETURNING id",
        [slug, name]
      );
      categoryIds[slug] = r.rows[0].id;
    }

    // Demo users - one per public role
    const hash = await bcrypt.hash(DEMO_PASSPHRASE, 10);
    // Phones are stored in +27 format - the same format the login route normalises to.
    const users = [
      ["customer", "+27710000001", "Thato (demo customer)", "consumer"],
      ["seller", "+27710000002", "Kgomotso (demo seller)", "entrepreneur"],
      ["courier", "+27710000003", "Pieter (demo courier)", "courier"],
      ["support", "+27710000004", "Support (demo)", "support"],
      ["seller2", "+27710000005", "Naledi (demo seller)", "entrepreneur"],
      ["courier2", "+27710000006", "Lerato (demo courier)", "courier"],
      ["support2", "+27710000007", "Sipho (demo support, approvals only)", "support"],
      ["applicant", "+27710000008", "Boitumelo (demo customer who applied to sell)", "consumer"],
      ["seller3", "+27710000009", "Tumelo (demo seller)", "entrepreneur"],
      ["seller4", "+27710000010", "Dineo (demo seller)", "entrepreneur"],
      ["lesego", "+27710000011", "Lesego (demo customer)", "consumer"],
      ["anna", "+27710000012", "Anna (demo customer)", "consumer"],
      ["kabelo", "+27710000013", "Kabelo (demo customer)", "consumer"],
    ];
    const userIds: Record<string, number> = {};
    for (const [key, phone, name, role] of users) {
      const r = await client.query(
        `INSERT INTO users (phone, display_name, password_hash, role)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [phone, name, hash, role]
      );
      userIds[key] = r.rows[0].id;
    }

    // Support scopes (spec Table 58). The main support account can do everything; the second
    // one only approvals, to show that scopes are enforced (TC-21).
    await client.query("UPDATE users SET staff_scopes = $2 WHERE id = $1", [userIds.support, ["approvals", "payments", "operations", "audit", "privacy"]]);
    await client.query("UPDATE users SET staff_scopes = $2 WHERE id = $1", [userIds.support2, ["approvals"]]);

    // The demo couriers are already approved.
    for (const [key, vehicle, area] of [["courier", "motorbike", "Wrenchville"], ["courier2", "bicycle", "Mothibistad"]]) {
      await client.query("INSERT INTO courier_profiles (user_id, vehicle_type, area) VALUES ($1, $2, $3)", [userIds[key], vehicle, area]);
    }

    // One application waiting for support, so the approvals queue isn't empty in the demo.
    await client.query(
      `INSERT INTO support_cases (case_type, requester_id, details) VALUES ('seller_application', $1, $2)`,
      [
        userIds.applicant,
        {
          businessName: "Boitumelo's Kitchen (demo)",
          description: "Home-made atchar and chakalaka.",
          area: "Seoding",
          pickupAddress: "[Demo pickup address], Seoding, Kuruman",
          phone: "+27710000008",
        },
      ]
    );

    // Two demo businesses, so the "one seller per order" rule can be demonstrated.
    const biz = await client.query(
      `INSERT INTO businesses (owner_id, name, description, area, pickup_address, phone)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [
        userIds.seller,
        "Kgomotso's Fresh Corner (demo)",
        "Fresh vegetables and home-baked bread.",
        "Wrenchville",
        "[Demo pickup address], Wrenchville, Kuruman",
        "+27710000002",
      ]
    );
    const businessId = biz.rows[0].id;

    const biz2 = await client.query(
      `INSERT INTO businesses (owner_id, name, description, area, pickup_address, phone)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [
        userIds.seller2,
        "Naledi's Beadwork (demo)",
        "Handmade beadwork and crafts.",
        "Mothibistad",
        "[Demo pickup address], Mothibistad, Kuruman",
        "+27710000005",
      ]
    );
    const businessId2 = biz2.rows[0].id;

    // Demo products - prices in cents (2500 = R25.00)
    const products: [string, string, string, number, number][] = [
      ["fresh-produce", "Spinach bunch", "1 bunch", 2500, 20],
      ["fresh-produce", "Tomatoes", "1 kg", 3000, 15],
      ["fresh-produce", "Onions", "1 x 2 kg bag", 3500, 10],
      ["pantry", "Brown bread", "1 loaf", 1800, 12],
      ["pantry", "Vetkoek", "Pack of 6", 3000, 8],
      ["pantry", "Maize meal", "1 x 5 kg bag", 6500, 6],
    ];
    for (const [cat, name, unit, price, stock] of products) {
      await client.query(
        `INSERT INTO products (business_id, category_id, name, unit_label, price_cents, stock_qty)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [businessId, categoryIds[cat], name, unit, price, stock]
      );
    }

    const crafts: [string, string, string, number, number][] = [
      ["crafts", "Beaded bracelet", "1 item", 12000, 5],
      ["crafts", "Beaded key ring", "1 item", 4500, 10],
    ];
    for (const [cat, name, unit, price, stock] of crafts) {
      await client.query(
        `INSERT INTO products (business_id, category_id, name, unit_label, price_cents, stock_qty)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [businessId2, categoryIds[cat], name, unit, price, stock]
      );
    }

    // Two more demo businesses so every kind of market on the Home screen has something in it.
    const moreBusinesses: [string, string, string, string, [string, string, string, number, number][]][] = [
      [
        "seller3",
        "Tumelo's Build & Farm Supplies (demo)",
        "Bricks, sand and cement for building, plus feed and live chickens for the farm.",
        "Batlharos",
        [
          ["building", "Cement stock bricks", "Pack of 100", 25000, 40],
          ["building", "Building sand", "1 x 50 kg bag", 4500, 30],
          ["building", "Cement", "1 x 50 kg bag", 11000, 25],
          ["farm-feed", "Lucerne bale", "1 bale", 18000, 15],
          ["farm-feed", "Layer mash (chicken feed)", "1 x 50 kg bag", 42000, 10],
          ["livestock", "Point-of-lay hen", "1 hen", 12000, 20],
          ["livestock", "Boer goat kid", "1 goat", 150000, 3],
        ],
      ],
      [
        "seller4",
        "Mma Dineo's Food Caravan (demo)",
        "Hot food from the caravan by the taxi rank: kotas, vetkoek and pap with stew.",
        "Kuruman town",
        [
          ["street-food", "Kota (quarter loaf)", "1 kota", 3500, 30],
          ["street-food", "Vetkoek with mince", "1 vetkoek", 2500, 40],
          ["street-food", "Pap and beef stew", "1 plate", 5500, 20],
          ["street-food", "Magwinya (fat cakes)", "Pack of 4", 2000, 25],
        ],
      ],
    ];
    for (const [owner, name, description, area, items] of moreBusinesses) {
      const b = await client.query(
        `INSERT INTO businesses (owner_id, name, description, area, pickup_address, phone)
         VALUES ($1, $2, $3, $4, $5, (SELECT phone FROM users WHERE id = $1)) RETURNING id`,
        [userIds[owner], name, description, area, `[Demo pickup address], ${area}, Kuruman`]
      );
      for (const [cat, productName, unit, price, stock] of items) {
        await client.query(
          `INSERT INTO products (business_id, category_id, name, unit_label, price_cents, stock_qty)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [b.rows[0].id, categoryIds[cat], productName, unit, price, stock]
        );
      }
    }

    // Too big (or alive) for a courier: customers collect these.
    await client.query(
      `UPDATE products SET collection_only = TRUE
        WHERE category_id IN (SELECT id FROM categories WHERE slug IN ('building', 'livestock')) OR name = 'Lucerne bale'`
    );
    // Packaged goods have barcodes the seller can scan (made-up numbers in the 600 = South Africa range).
    await client.query("UPDATE products SET barcode = '6001234500017' WHERE name = 'Maize meal'");
    await client.query("UPDATE products SET barcode = '6009876500025' WHERE name = 'Cement'");

    // Order history from the last few weeks: completed pickup orders paid in cash, most with a review.
    // It makes the ratings, the seller numbers and "Entrepreneur of the Month" meaningful in a demo.
    // Reviews are in English, Setswana and Afrikaans, like real Kuruman customers would write.
    // Reset the demo data shortly before presenting, so these dates are recent.
    type Past = { shop: string; buyer: string; items: [string, number][]; daysAgo: number; rating?: number; comment?: string; reply?: string };
    const history: Past[] = [
      { shop: "Mma Dineo's Food Caravan (demo)", buyer: "customer", items: [["Kota (quarter loaf)", 2]], daysAgo: 24, rating: 5, comment: "Best kota in Kuruman! Hot and full of chips." },
      { shop: "Mma Dineo's Food Caravan (demo)", buyer: "lesego", items: [["Vetkoek with mince", 3]], daysAgo: 20, rating: 5, comment: "Vetkoek e monate thata, e ne e sa le mogote." },
      { shop: "Mma Dineo's Food Caravan (demo)", buyer: "anna", items: [["Pap and beef stew", 1]], daysAgo: 15, rating: 4, comment: "Lekker kos en vriendelike diens. Moes bietjie wag." },
      { shop: "Mma Dineo's Food Caravan (demo)", buyer: "kabelo", items: [["Magwinya (fat cakes)", 2]], daysAgo: 11, rating: 5, comment: "Fresh magwinya every time. Friendly lady!" },
      { shop: "Mma Dineo's Food Caravan (demo)", buyer: "customer", items: [["Kota (quarter loaf)", 1], ["Magwinya (fat cakes)", 1]], daysAgo: 6, rating: 3, comment: "Food was tasty but a bit cold when I collected it.", reply: "Sorry about that! Come at 12:00 when the oil is hottest - your next magwinya is on us." },
      { shop: "Mma Dineo's Food Caravan (demo)", buyer: "lesego", items: [["Pap and beef stew", 2]], daysAgo: 3, rating: 5, comment: "Dijo tse di monate le tlhwatlhwa e siame." },
      { shop: "Kgomotso's Fresh Corner (demo)", buyer: "anna", items: [["Spinach bunch", 2], ["Tomatoes", 1]], daysAgo: 22, rating: 5, comment: "Spinach was so fresh, picked that morning!", reply: "Thank you Anna! We pick every morning before 7." },
      { shop: "Kgomotso's Fresh Corner (demo)", buyer: "kabelo", items: [["Brown bread", 2]], daysAgo: 17, rating: 4, comment: "Good bread. I waited a while for my order to be accepted." },
      { shop: "Kgomotso's Fresh Corner (demo)", buyer: "customer", items: [["Onions", 1], ["Maize meal", 1]], daysAgo: 9, rating: 5, comment: "Merogo e ne e le mesha. Ke a leboga!" },
      { shop: "Kgomotso's Fresh Corner (demo)", buyer: "lesego", items: [["Vetkoek", 1]], daysAgo: 4 },
      { shop: "Tumelo's Build & Farm Supplies (demo)", buyer: "kabelo", items: [["Cement", 4], ["Building sand", 6]], daysAgo: 12, rating: 4, comment: "Good price on cement. Collection was quick." },
      { shop: "Tumelo's Build & Farm Supplies (demo)", buyer: "anna", items: [["Lucerne bale", 2]], daysAgo: 5, rating: 5, comment: "Goeie lusern, my bokke is gelukkig." },
      { shop: "Naledi's Beadwork (demo)", buyer: "customer", items: [["Beaded bracelet", 1]], daysAgo: 8, rating: 5, comment: "Beautiful beadwork, a perfect gift." },
    ];
    for (const past of history) {
      const shop = (await client.query("SELECT id, owner_id FROM businesses WHERE name = $1", [past.shop])).rows[0];
      const lines = [];
      for (const [name, qty] of past.items) {
        const p = (await client.query("SELECT id, name, unit_label, price_cents FROM products WHERE business_id = $1 AND name = $2", [shop.id, name])).rows[0];
        lines.push({ ...p, qty });
      }
      const subtotal = lines.reduce((sum, l) => sum + l.price_cents * l.qty, 0);
      const at = (minutes: number) => `now() - interval '${past.daysAgo} days' + interval '${minutes} minutes'`;
      const o = await client.query(
        `INSERT INTO orders (consumer_id, business_id, status, fulfilment, payment_method, subtotal_cents, total_cents,
                             accept_by, idempotency_key, request_hash, created_at, updated_at)
         VALUES ($1, $2, 'completed', 'pickup', 'cash', $3, $3, ${at(30)}, $4, $5, ${at(0)}, ${at(95)})
         RETURNING id, consumer_id`,
        [userIds[past.buyer], shop.id, subtotal, `demo-history-${past.daysAgo}-${past.buyer}`, "0".repeat(64)]
      );
      const orderId = o.rows[0].id;
      for (const l of lines) {
        await client.query(
          `INSERT INTO order_items (order_id, product_id, product_name, unit_label, unit_price_cents, quantity, line_total_cents)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [orderId, l.id, l.name, l.unit_label, l.price_cents, l.qty, l.price_cents * l.qty]
        );
      }
      // The same steps a real order goes through, each recorded (business rule 8).
      const steps: [string | null, string, number, number | null][] = [
        [null, "pending_acceptance", 0, past.buyer === "customer" ? userIds.customer : userIds[past.buyer]],
        ["pending_acceptance", "confirmed", 6, shop.owner_id],
        ["confirmed", "ready", 40, shop.owner_id],
        ["ready", "completed", 95, shop.owner_id],
      ];
      for (const [from, to, minutes, by] of steps) {
        await client.query(
          `INSERT INTO order_status_history (order_id, from_status, to_status, changed_by, created_at) VALUES ($1, $2, $3, $4, ${at(minutes)})`,
          [orderId, from, to, by]
        );
      }
      await client.query(
        `INSERT INTO cash_receipts (order_id, collected_by, collected_cents, remitted_cents, collected_at, remitted_at, status, acknowledged_by)
         VALUES ($1, $2, $3, $3, ${at(95)}, ${at(95)}, 'remitted', $2)`,
        [orderId, shop.owner_id, subtotal]
      );
      if (past.rating) {
        await client.query(
          `INSERT INTO reviews (order_id, business_id, consumer_id, rating, comment, seller_reply, seller_replied_at, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $6::text IS NULL THEN NULL ELSE ${at(60 * 30)} END, ${at(60 * 5)})`,
          [orderId, shop.id, userIds[past.buyer], past.rating, past.comment ?? null, past.reply ?? null]
        );
      }
    }

    await client.query("COMMIT");
    console.log("Demo data added.");
    // A private SEED_PASSPHRASE is never printed - terminals get screenshotted and logged.
    console.log(
      process.env.SEED_PASSPHRASE
        ? "Demo logins (passphrase for all: the SEED_PASSPHRASE you set):"
        : `Demo logins (passphrase for all: ${DEMO_PASSPHRASE}):`
    );
    for (const [, phone, name] of users) console.log(`  ${phone}  ${name}`);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

main()
  .catch((err) => {
    console.error("Seeding failed:", describeError(err));
    process.exitCode = 1;
  })
  .finally(() => pool.end());
