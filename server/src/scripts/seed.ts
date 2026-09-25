import bcrypt from "bcryptjs";
import { pool } from "../db";

// Synthetic demo data only - no real people or businesses.
// Every demo account uses the same passphrase so the demo is easy to run.
// It meets the 15-character minimum from spec section 7.3.
const DEMO_PASSPHRASE = "Kuruman Oasis 2026";

async function main() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Categories
    const categories = [
      ["fresh-produce", "Fresh produce"],
      ["bakery", "Bakery"],
      ["pantry", "Pantry"],
      ["crafts", "Crafts & beadwork"],
      ["household", "Household"],
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
      ["bakery", "Brown bread", "1 loaf", 1800, 12],
      ["bakery", "Vetkoek", "Pack of 6", 3000, 8],
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

    await client.query("COMMIT");
    console.log("Demo data added.");
    console.log(`Demo logins (passphrase for all: ${DEMO_PASSPHRASE}):`);
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
    console.error("Seeding failed:", err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
