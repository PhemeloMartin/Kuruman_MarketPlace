import bcrypt from "bcryptjs";
import { pool } from "../db";

// Synthetic demo data only - no real people or businesses.
// Every demo account uses the same passphrase so the demo is easy to run.
const DEMO_PASSPHRASE = "Kuruman@2026";

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
    const users = [
      ["0710000001", "Thato (demo customer)", "consumer"],
      ["0710000002", "Kgomotso (demo seller)", "entrepreneur"],
      ["0710000003", "Pieter (demo courier)", "courier"],
      ["0710000004", "Support (demo)", "support"],
    ];
    const userIds: Record<string, number> = {};
    for (const [phone, name, role] of users) {
      const r = await client.query(
        `INSERT INTO users (phone, display_name, password_hash, role)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [phone, name, hash, role]
      );
      userIds[role] = r.rows[0].id;
    }

    // Demo business owned by the demo seller
    const biz = await client.query(
      `INSERT INTO businesses (owner_id, name, description, area, pickup_address, phone)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [
        userIds.entrepreneur,
        "Kgomotso's Fresh Corner (demo)",
        "Fresh vegetables and home-baked bread.",
        "Wrenchville",
        "[Demo pickup address], Wrenchville, Kuruman",
        "0710000002",
      ]
    );
    const businessId = biz.rows[0].id;

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

    await client.query("COMMIT");
    console.log("Demo data added.");
    console.log(`Demo logins (passphrase for all: ${DEMO_PASSPHRASE}):`);
    for (const [phone, name] of users) console.log(`  ${phone}  ${name}`);
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
