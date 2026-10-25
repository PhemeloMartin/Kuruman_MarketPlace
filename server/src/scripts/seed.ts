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
