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
    // yet, so sellers choose them by hand until the model is retrained with examples. Water and books
    // are the markets with a Kuruman story (db/migrations.sql already adds them, hence ON CONFLICT).
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
      ["water", "Water & ice"],
      ["books", "Books & lessons"],
    ];
    const categoryIds: Record<string, number> = {};
    for (const [slug, name] of categories) {
      const r = await client.query(
        `INSERT INTO categories (slug, name) VALUES ($1, $2)
         ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
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
      // Tebogo helps his grandmother, Mma Kefilwe, run her stall. She has a basic phone: 071 000 0014.
      ["helper", "+27710000015", "Tebogo (demo helper for Mma Kefilwe's stall)", "entrepreneur"],
      // Places the synthetic older sales history below (so real demo customers' order lists stay short).
      ["history", "+27710000099", "Walk-in customers (synthetic demo history)", "consumer"],
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
    // Pieter has all his documents on file; Lerato was approved with proof that she applied for police
    // clearance, and still has to send the certificate (her Deliveries page reminds her).
    await client.query(
      "INSERT INTO courier_profiles (user_id, vehicle_type, area, documents_outstanding) VALUES ($1, 'motorbike', 'Wrenchville', '{}')",
      [userIds.courier]
    );
    await client.query(
      `INSERT INTO courier_profiles (user_id, vehicle_type, area, documents_outstanding, documents_due)
       VALUES ($1, 'bicycle', 'Mothibistad', '{police_clearance}', current_date + 10)`,
      [userIds.courier2]
    );

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
      ["fresh-produce", "Tomatoes", "1 kg", 3000, 40],
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

    // A market stall: listed by a helper, orders go to the stall holder's basic phone by SMS.
    const stall = await client.query(
      `INSERT INTO businesses (owner_id, name, description, area, pickup_address, phone, kind, sms_alerts,
                               stall_location, stall_days, stall_opens, stall_closes)
       VALUES ($1, $2, $3, 'Kuruman town', $4, '+27710000014', 'market_stall', TRUE, $5, '{1,2,3,4,5,6}', '07:00', '16:00')
       RETURNING id`,
      [
        userIds.helper,
        "Mma Kefilwe's Vegetable Stall (demo)",
        "Fresh morogo, spinach and green mealies from Mma Kefilwe's garden. At the same corner for 12 years.",
        "Main Street, next to the taxi rank",
        "Main Street, next to the taxi rank",
      ]
    );
    for (const [cat, name, unit, price, stock] of [
      ["fresh-produce", "Morogo (wild spinach)", "1 bunch", 1500, 25],
      ["fresh-produce", "Green mealies", "Pack of 3", 2000, 30],
      ["fresh-produce", "Butternut", "1 butternut", 1800, 15],
      ["fresh-produce", "Spinach bunch (stall)", "1 bunch", 1200, 20],
    ] as [string, string, string, number, number][]) {
      await client.query(
        `INSERT INTO products (business_id, category_id, name, unit_label, price_cents, stock_qty) VALUES ($1, $2, $3, $4, $5, $6)`,
        [stall.rows[0].id, categoryIds[cat], name, unit, price, stock]
      );
    }

    // Kuruman Business Directory: made-up local services (demo numbers in the 071 000 02xx range).
    const listings: [string, string, string, string, string, boolean, string][] = [
      ["Thabo's Plumbing (demo)", "plumbing", "Geysers, burst pipes, toilets and taps. Call-outs in town and nearby villages.", "Kuruman town", "+27710000201", true, "Mon-Sat 07:00-18:00"],
      ["Lindiwe Hair Studio (demo)", "hair_beauty", "Braids, relaxers, cuts and nails. Walk-ins welcome.", "Wrenchville", "+27710000202", true, "Tue-Sat 08:00-17:00"],
      ["Mothibistad Auto Repairs (demo)", "mechanic", "Services, brakes, clutches and diagnostics for cars and bakkies.", "Mothibistad", "+27710000203", false, "Mon-Fri 08:00-17:00"],
      ["Mma Neo Sewing (demo)", "sewing", "School uniforms, traditional dresses, alterations and repairs.", "Seoding", "+27710000204", true, "Mon-Fri 09:00-16:00"],
      ["Kgosi Electrical (demo)", "electrical", "Wiring, prepaid meters, COC certificates and solar installations.", "Kuruman town", "+27710000205", false, "Mon-Sat 07:30-17:00"],
      ["Batlharos Moving & Transport (demo)", "transport", "Bakkie and truck hire for furniture, building material and livestock.", "Batlharos", "+27710000206", true, "Every day 06:00-20:00"],
      ["Grade 12 Maths Lessons (demo)", "lessons", "Maths and Physical Science lessons for Grades 10-12, after school and Saturdays.", "Wrenchville", "+27710000207", true, "Mon-Sat 15:00-19:00"],
      ["Kalahari Catering (demo)", "events", "Weddings, funerals and parties: food, tents and chairs.", "Kuruman town", "+27710000208", true, "By appointment"],
    ];
    for (const [name, category, description, area, phone, whatsapp, hours] of listings) {
      await client.query(
        `INSERT INTO directory_listings (name, category, description, area, phone, has_whatsapp, hours, submitted_by, consent_at,
                                         status, decided_by, decided_at, decision_note)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now(), 'approved', $9, now(), 'Demo listing')`,
        [name, category, description, area, phone, whatsapp, hours, userIds.customer, userIds.support]
      );
    }
    // One waiting for support, so the approvals list isn't empty in the demo.
    await client.query(
      `INSERT INTO directory_listings (name, category, description, area, phone, has_whatsapp, hours, submitted_by, consent_at)
       VALUES ('Quick Fix Phone Repairs (demo)', 'repairs', 'Cracked screens, batteries and charging ports.', 'Kuruman town',
               '+27710000209', TRUE, 'Mon-Sat 09:00-17:00', $1, now())`,
      [userIds.customer]
    );

    // Tumelo's shop delivers bricks, sand and feed with its own bakkie and truck.
    await client.query(
      `UPDATE businesses SET own_delivery_fee_cents = 35000, own_delivery_note = 'Bakkie and 4-ton truck. Kuruman, Batlharos and Mothibistad.'
        WHERE name LIKE 'Tumelo%'`
    );
    // Too big (or alive) for a courier: customers collect these, or the shop delivers them itself.
    await client.query(
      `UPDATE products SET collection_only = TRUE
        WHERE category_id IN (SELECT id FROM categories WHERE slug IN ('building', 'livestock')) OR name = 'Lucerne bale'`
    );
    // What the sellers wrote about their products. Honest texts that mention cash, collecting or delivery
    // must NOT be flagged by the AI screening: they show it can tell them apart from the two below.
    const descriptions: [string, string][] = [
      ["Spinach bunch", "Picked every morning in our garden in Wrenchville, washed and tied in big bunches."],
      ["Tomatoes", "Firm, ripe tomatoes from farms near Kuruman. Good for chakalaka and salads."],
      ["Onions", "Brown onions in a 2 kg pocket. They keep for weeks in a cool, dry place."],
      ["Brown bread", "Baked fresh every morning from 05:00. Soft inside with a crisp crust."],
      ["Vetkoek", "Six golden vetkoek. Order before 10:00 for the warm batch."],
      ["Maize meal", "Super maize meal, 5 kg. Pay cash when you collect at the shop."],
      ["Beaded bracelet", "Glass beads on strong wire in the colours of the Kalahari. Made by hand in Mothibistad."],
      ["Cement stock bricks", "Strong cement bricks, 100 per pack. Collect with your own bakkie or ask for our truck."],
      ["Building sand", "Clean, sifted sand for plaster and mortar."],
      ["Cement", "General-purpose cement in 50 kg bags, always fresh stock."],
      ["Lucerne bale", "Green, leafy lucerne bales of about 25 kg."],
      ["Layer mash (chicken feed)", "Complete feed for laying hens, 50 kg bag."],
      ["Point-of-lay hen", "Healthy, vaccinated hens of about 18 weeks, ready to start laying."],
      ["Kota (quarter loaf)", "Quarter loaf with chips, polony, cheese, egg and atchar."],
      ["Vetkoek with mince", "Fresh vetkoek filled with our home-made curried mince."],
      ["Pap and beef stew", "Stiff pap with slow-cooked beef stew and chakalaka."],
      ["Magwinya (fat cakes)", "Four warm fat cakes, fried fresh all day."],
      ["Morogo (wild spinach)", "Wild spinach picked by Mma Kefilwe. Cook it with onion and tomato."],
      ["Green mealies", "Sweet green mealies, three in a pack. Boil them or roast them on the fire."],
      ["Butternut", "Sweet butternut from the garden, about 1.5 kg."],
      ["Spinach bunch (stall)", "A big bunch of spinach from Mma Kefilwe's garden."],
    ];
    for (const [name, description] of descriptions) {
      await client.query("UPDATE products SET description = $2 WHERE name = $1", [name, description]);
    }
    // Two listings that try to take the sale off the site, so the AI screening has real things to flag for
    // support in the demo (support then decides: "It's fine" or "Take off sale"): a phone number for
    // "cheaper" orders on WhatsApp, and a deposit by eWallet before the buyer has seen the animal.
    // (A third is a review advertising a phone number - in the reviews below.)
    await client.query(
      "UPDATE products SET description = 'For bulk orders WhatsApp me on 072 555 1234, cheaper than here.' WHERE name = 'Beaded key ring'"
    );
    await client.query(
      "UPDATE products SET description = 'Serious buyers only. Send a R500 deposit by eWallet to reserve your goat, the rest when you collect.' WHERE name = 'Boer goat kid'"
    );
    // Packaged goods have barcodes the seller can scan (made-up numbers in the 600 = South Africa range).
    await client.query("UPDATE products SET barcode = '6001234500017' WHERE name = 'Maize meal'");
    await client.query("UPDATE products SET barcode = '6009876500025' WHERE name = 'Cement'");

    // ---------------------------------------------------------------------------
    // Order history and reviews, ALL MADE UP, so the shop numbers, the ratings and the AI models have
    // weeks of data to work with in a demo:
    //   1. orders that customers reviewed - in English, Setswana and Afrikaans like Kuruman customers would
    //      write, good and bad - so the review AI has something to summarise ("Customers mention ...");
    //   2. SYNTHETIC walk-in sales for every shop over the last 12 weeks (busier on Fridays, Saturdays and
    //      in payday week, slowly growing), so every seller gets a sales forecast.
    // Dates count back from today: reset the demo data shortly before presenting.
    // ---------------------------------------------------------------------------

    // More made-up customers, so the reviews come from many different people (071 000 0101 to 0116).
    const reviewers = ["Mpho", "Kagiso", "Refilwe", "Johan", "Onalenna", "Marike", "Tshepo", "Gaone",
      "Karabo", "Elsabe", "Bontle", "Olebogeng", "Riaan", "Keabetswe", "Lorato", "Ayanda"];
    for (const [i, name] of reviewers.entries()) {
      const r = await client.query(
        "INSERT INTO users (phone, display_name, password_hash, role) VALUES ($1, $2, $3, 'consumer') RETURNING id",
        [`+277100001${String(i + 1).padStart(2, "0")}`, `${name} (demo customer)`, hash]
      );
      userIds[name.toLowerCase()] = r.rows[0].id;
    }

    // The shops and products by name, for the lists below.
    const shopIds: Record<string, number> = {};
    for (const [key, name] of [["kgomotso", "Kgomotso%"], ["naledi", "Naledi%"], ["tumelo", "Tumelo%"], ["dineo", "Mma Dineo%"], ["kefilwe", "Mma Kefilwe%"]]) {
      shopIds[key] = Number((await client.query("SELECT id FROM businesses WHERE name LIKE $1", [name])).rows[0].id);
    }
    const productIds: Record<string, number> = {};
    const priceOf: Record<number, number> = {};
    for (const p of (await client.query("SELECT id, name, price_cents FROM products")).rows) {
      productIds[p.name] = Number(p.id);
      priceOf[Number(p.id)] = p.price_cents;
    }

    type DemoOrder = {
      key: string; // unique per customer: finds the order again for its items, history and review
      buyer: number;
      shop: number;
      status: "completed" | "declined" | "expired";
      at: string; // when it was placed, South African time: "2026-10-30 12:15"
      items: { product: number; qty: number }[];
    };
    const orders: DemoOrder[] = [];
    const reviews: { key: string; buyer: number; rating: number; comment: string | null; reply: string | null }[] = [];

    // Days counted back from today's date in South Africa (read them with getUTC...).
    const today = new Date(new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Johannesburg" }) + "T00:00:00Z");
    const daysAgoDate = (n: number) => new Date(today.getTime() - n * 86_400_000);
    const localTime = (day: Date, minutes: number) =>
      `${day.toISOString().slice(0, 10)} ${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

    // 1. Reviewed orders. Lesego's vetkoek has no review yet, so a review can be written live in the demo.
    //    "customer" is Thato. The karabo review at Tumelo's advertises a phone number: the AI screening
    //    flags it, and support decides whether to hide it.
    type Reviewed = { shop: string; buyer: string; daysAgo: number; items: [string, number][]; rating?: number; comment?: string; reply?: string };
    const reviewed: Reviewed[] = [
      // Kgomotso's Fresh Corner: loved for fresh vegetables; slow to accept orders now and then.
      { shop: "kgomotso", buyer: "anna", daysAgo: 22, items: [["Spinach bunch", 2], ["Tomatoes", 1]], rating: 5, comment: "Spinach was so fresh, picked that morning!", reply: "Thank you Anna! We pick every morning before 7." },
      { shop: "kgomotso", buyer: "kabelo", daysAgo: 17, items: [["Brown bread", 2]], rating: 4, comment: "Good bread. I waited a while for my order to be accepted." },
      { shop: "kgomotso", buyer: "customer", daysAgo: 9, items: [["Onions", 1], ["Maize meal", 1]], rating: 5, comment: "Merogo e ne e le mesha. Ke a leboga!" },
      { shop: "kgomotso", buyer: "lesego", daysAgo: 4, items: [["Vetkoek", 1]] },
      { shop: "kgomotso", buyer: "mpho", daysAgo: 2, items: [["Tomatoes", 2]], rating: 5, comment: "Tomatoes are red and firm, perfect for chakalaka. Fair price too." },
      { shop: "kgomotso", buyer: "refilwe", daysAgo: 3, items: [["Spinach bunch", 1], ["Brown bread", 1]], rating: 5, comment: "Sepinatšhe se ne se le sesha thata. Borotho le jone bo ne bo le bonolo. Ke a leboga mma!", reply: "Ke a leboga Refilwe! Re go letetse gape." },
      { shop: "kgomotso", buyer: "johan", daysAgo: 5, items: [["Maize meal", 1]], rating: 4, comment: "Goeie prys vir mieliemeel, maar ek moes lank wag vir die bestelling.", reply: "Dankie Johan. Ons kyk nou elke 15 minute of daar nuwe bestellings is." },
      { shop: "kgomotso", buyer: "onalenna", daysAgo: 6, items: [["Vetkoek", 2]], rating: 5, comment: "Magwinya a ne a sa ntse a le mogote fa ke a tsaya. A monate thata!" },
      { shop: "kgomotso", buyer: "marike", daysAgo: 7, items: [["Tomatoes", 1], ["Onions", 1]], rating: 5, comment: "Baie vars groente en die tannie is altyd vriendelik.", reply: "Baie dankie Marike, lekker kook!" },
      { shop: "kgomotso", buyer: "tshepo", daysAgo: 8, items: [["Brown bread", 3]], rating: 3, comment: "Bread was fine but it was only ready after an hour. Please accept orders faster.", reply: "Sorry Tshepo - since this week we check for new orders every 15 minutes." },
      { shop: "kgomotso", buyer: "gaone", daysAgo: 10, items: [["Spinach bunch", 2]], rating: 5, comment: "Fresh spinach every week, and cheaper than the supermarket.", reply: "Thank you Gaone, see you next week!" },
      { shop: "kgomotso", buyer: "karabo", daysAgo: 11, items: [["Onions", 1]], rating: 2, comment: "Some onions in the bag were soft and rotten inside.", reply: "Sorry Karabo, that bag should never have gone out. Bring the receipt and we'll swap it." },
      { shop: "kgomotso", buyer: "elsabe", daysAgo: 12, items: [["Brown bread", 1], ["Spinach bunch", 1]], rating: 5, comment: "Die bruinbrood is vars gebak en die spinasie pragtig.", reply: "Dankie Elsabe! Die brood kom elke oggend om 05:00 uit die oond." },
      { shop: "kgomotso", buyer: "bontle", daysAgo: 13, items: [["Tomatoes", 2], ["Spinach bunch", 1]], rating: 4, comment: "Ditamati di ne di le ntšha, mme ke emetse lobaka lo loleele gore taelo ya me e amogelwe.", reply: "Maitshwarelo Bontle. Jaanong re tlhola ditaelo morago ga metsotso e le 15." },
      { shop: "kgomotso", buyer: "olebogeng", daysAgo: 14, items: [["Maize meal", 2]], rating: 5, comment: "Good price on maize meal and the collection was quick." },
      { shop: "kgomotso", buyer: "riaan", daysAgo: 16, items: [["Vetkoek", 1], ["Brown bread", 1]], rating: 4, comment: "Lekker vetkoek, net 'n bietjie duur." },
      { shop: "kgomotso", buyer: "keabetswe", daysAgo: 18, items: [["Spinach bunch", 1]], rating: 5, comment: "Ke rata gore ba kgetha merogo mo mosong. E ntšha ka metlha.", reply: "Ke a leboga Keabetswe!" },
      { shop: "kgomotso", buyer: "lorato", daysAgo: 19, items: [["Tomatoes", 1]], rating: 5, comment: "Friendly service and fresh tomatoes. Will order again." },
      { shop: "kgomotso", buyer: "ayanda", daysAgo: 21, items: [["Brown bread", 2], ["Vetkoek", 1]], rating: 2, comment: "Waited almost two hours before they accepted my order. My lunch break was over.", reply: "Sorry Ayanda - we were at the market that morning. We now check for orders every 15 minutes." },
      { shop: "kgomotso", buyer: "mpho", daysAgo: 24, items: [["Onions", 1], ["Tomatoes", 1]], rating: 5, comment: "Everything fresh and well packed. Thank you Kgomotso!" },
      { shop: "kgomotso", buyer: "kagiso", daysAgo: 26, items: [["Maize meal", 1], ["Brown bread", 1]], rating: 4, comment: "Tlhwatlhwa e siame, borotho bo ne bo le monate." },
      { shop: "kgomotso", buyer: "anna", daysAgo: 28, items: [["Spinach bunch", 1], ["Tomatoes", 2]], rating: 5, comment: "Weer eens vars en goedkoop. Dankie!" },
      { shop: "kgomotso", buyer: "refilwe", daysAgo: 33, items: [["Vetkoek", 1]], rating: 3, comment: "Ke tsere magwinya ka 11 mme a ne a setse a fodile." },
      { shop: "kgomotso", buyer: "johan", daysAgo: 37, items: [["Tomatoes", 2]], rating: 5, comment: "Beste tamaties in Kuruman." },
      { shop: "kgomotso", buyer: "tshepo", daysAgo: 41, items: [["Spinach bunch", 1], ["Onions", 1]], rating: 4, comment: "Fresh veggies, but the onions were a bit small for the price." },
      { shop: "kgomotso", buyer: "gaone", daysAgo: 45, items: [["Brown bread", 1]], rating: 5, comment: "The brown bread is soft and fresh. My kids love it." },
      { shop: "kgomotso", buyer: "kabelo", daysAgo: 52, items: [["Maize meal", 1]], rating: 4, comment: "Quick collection, friendly lady." },
      { shop: "kgomotso", buyer: "lorato", daysAgo: 60, items: [["Spinach bunch", 2]], rating: 5, comment: "Spinach was fresh and clean, no sand at all." },

      // Mma Dineo's Food Caravan: tasty food; sometimes cold or slow at lunch time.
      { shop: "dineo", buyer: "customer", daysAgo: 24, items: [["Kota (quarter loaf)", 2]], rating: 5, comment: "Best kota in Kuruman! Hot and full of chips." },
      { shop: "dineo", buyer: "lesego", daysAgo: 20, items: [["Vetkoek with mince", 3]], rating: 5, comment: "Vetkoek e monate thata, e ne e sa le mogote." },
      { shop: "dineo", buyer: "anna", daysAgo: 15, items: [["Pap and beef stew", 1]], rating: 4, comment: "Lekker kos en vriendelike diens. Moes bietjie wag." },
      { shop: "dineo", buyer: "kabelo", daysAgo: 11, items: [["Magwinya (fat cakes)", 2]], rating: 5, comment: "Fresh magwinya every time. Friendly lady!" },
      { shop: "dineo", buyer: "customer", daysAgo: 6, items: [["Kota (quarter loaf)", 1], ["Magwinya (fat cakes)", 1]], rating: 3, comment: "Food was tasty but a bit cold when I collected it.", reply: "Sorry about that! Come at 12:00 when the oil is hottest - your next magwinya is on us." },
      { shop: "dineo", buyer: "lesego", daysAgo: 3, items: [["Pap and beef stew", 2]], rating: 5, comment: "Dijo tse di monate le tlhwatlhwa e siame." },
      { shop: "dineo", buyer: "mpho", daysAgo: 1, items: [["Kota (quarter loaf)", 1]], rating: 5, comment: "The kota was massive and tasty, worth every cent." },
      { shop: "dineo", buyer: "kagiso", daysAgo: 2, items: [["Vetkoek with mince", 2]], rating: 5, comment: "Mince e ne e le monate, magwinya a le mogote. Ke tla boa gape!", reply: "Re a leboga Kagiso, re go letetse!" },
      { shop: "dineo", buyer: "johan", daysAgo: 2, items: [["Pap and beef stew", 1]], rating: 4, comment: "Lekker bredie, maar die pap het afgekoel voor ek by die huis was.", reply: "Jammer Johan! Vra volgende keer vir 'n bak met 'n deksel, dan bly dit warm." },
      { shop: "dineo", buyer: "onalenna", daysAgo: 4, items: [["Kota (quarter loaf)", 2]], rating: 5, comment: "Ready in ten minutes, hot and delicious.", reply: "Thank you Onalenna, enjoy!" },
      { shop: "dineo", buyer: "marike", daysAgo: 5, items: [["Magwinya (fat cakes)", 3]], rating: 5, comment: "Die vetkoek is altyd vars en die tannie is so gaaf." },
      { shop: "dineo", buyer: "tshepo", daysAgo: 7, items: [["Kota (quarter loaf)", 1], ["Vetkoek with mince", 1]], rating: 2, comment: "Waited 40 minutes at lunch time and the chips were cold.", reply: "Lunch time is busy - order before 11:30 and it's ready when you arrive. Sorry Tshepo!" },
      { shop: "dineo", buyer: "gaone", daysAgo: 8, items: [["Pap and beef stew", 1]], rating: 5, comment: "Nama e ne e le bonolo e bile e le monate, jaaka mme a e apeela kwa gae." },
      { shop: "dineo", buyer: "karabo", daysAgo: 9, items: [["Kota (quarter loaf)", 2]], rating: 4, comment: "Tasty kota, good price for the size." },
      { shop: "dineo", buyer: "elsabe", daysAgo: 10, items: [["Vetkoek with mince", 2]], rating: 5, comment: "Heerlike vetkoek met maalvleis, baie goeie prys." },
      { shop: "dineo", buyer: "bontle", daysAgo: 12, items: [["Magwinya (fat cakes)", 2]], rating: 5, comment: "Magwinya a ne a le masha e bile a le monate. Mma o na le botsalano." },
      { shop: "dineo", buyer: "olebogeng", daysAgo: 13, items: [["Kota (quarter loaf)", 1]], rating: 3, comment: "The kota was okay, a bit too much sauce for me." },
      { shop: "dineo", buyer: "riaan", daysAgo: 14, items: [["Pap and beef stew", 2]], rating: 5, comment: "Lekker kos teen 'n goeie prys. Aanbeveel!" },
      { shop: "dineo", buyer: "keabetswe", daysAgo: 16, items: [["Kota (quarter loaf)", 1], ["Magwinya (fat cakes)", 1]], rating: 5, comment: "Quick service even when the taxi rank was busy." },
      { shop: "dineo", buyer: "lorato", daysAgo: 17, items: [["Vetkoek with mince", 1]], rating: 1, comment: "The lady at the window was rude when I asked about my order.", reply: "We're sorry, Lorato. That's not how we treat customers - please ask for Dineo next time." },
      { shop: "dineo", buyer: "ayanda", daysAgo: 18, items: [["Kota (quarter loaf)", 2]], rating: 5, comment: "Hot, fresh and tasty. Best lunch in town." },
      { shop: "dineo", buyer: "mpho", daysAgo: 21, items: [["Pap and beef stew", 1]], rating: 4, comment: "Good food, but I had to wait a bit." },
      { shop: "dineo", buyer: "kagiso", daysAgo: 23, items: [["Magwinya (fat cakes)", 2]], rating: 5, comment: "Ke reka magwinya fano gantsi, ga ke ise ke swabe." },
      { shop: "dineo", buyer: "onalenna", daysAgo: 26, items: [["Kota (quarter loaf)", 1]], rating: 5, comment: "Filling and full of flavour - a lot of food for R35." },
      { shop: "dineo", buyer: "johan", daysAgo: 29, items: [["Vetkoek with mince", 2]], rating: 5, comment: "Altyd warm en vars. Dankie tannie!" },
      { shop: "dineo", buyer: "karabo", daysAgo: 34, items: [["Pap and beef stew", 1]], rating: 4, comment: "Tasty stew, I just wish the portion was bigger for R55." },
      { shop: "dineo", buyer: "tshepo", daysAgo: 40, items: [["Kota (quarter loaf)", 2]], rating: 5, comment: "Fast and friendly, the kota was still hot when I got to the office." },
      { shop: "dineo", buyer: "bontle", daysAgo: 47, items: [["Vetkoek with mince", 1]], rating: 5, comment: "Dijo di siame thata, ke a leboga." },

      // Tumelo's Build & Farm Supplies: good prices and help with loading; the truck can be late.
      { shop: "tumelo", buyer: "kabelo", daysAgo: 12, items: [["Cement", 4], ["Building sand", 6]], rating: 4, comment: "Good price on cement. Collection was quick." },
      { shop: "tumelo", buyer: "anna", daysAgo: 5, items: [["Lucerne bale", 2]], rating: 5, comment: "Goeie lusern, my bokke is gelukkig." },
      { shop: "tumelo", buyer: "karabo", daysAgo: 2, items: [["Cement", 2]], rating: 4, comment: "Cement was fine. I also make cheaper bricks at home, call me on 073 456 7812." },
      { shop: "tumelo", buyer: "johan", daysAgo: 3, items: [["Cement stock bricks", 2]], rating: 5, comment: "Bricks were ready when I arrived and they helped me load. Top service." },
      { shop: "tumelo", buyer: "riaan", daysAgo: 6, items: [["Layer mash (chicken feed)", 1]], rating: 4, comment: "Hoendervoer is hier goedkoper as by die koöperasie." },
      { shop: "tumelo", buyer: "kagiso", daysAgo: 8, items: [["Point-of-lay hen", 5]], rating: 5, comment: "Dikoko di itekanetse e bile di a beela. Ke a leboga rre!" },
      { shop: "tumelo", buyer: "tshepo", daysAgo: 10, items: [["Cement", 10]], rating: 2, comment: "The delivery truck came a day late and my builders were waiting.", reply: "Apologies Tshepo - the truck broke down. Your next delivery is free." },
      { shop: "tumelo", buyer: "marike", daysAgo: 15, items: [["Lucerne bale", 3]], rating: 5, comment: "Lusern van goeie gehalte en vinnig gelaai." },
      { shop: "tumelo", buyer: "olebogeng", daysAgo: 18, items: [["Building sand", 10]], rating: 3, comment: "Sand was fine but the delivery fee is expensive for a short distance." },
      { shop: "tumelo", buyer: "mpho", daysAgo: 20, items: [["Cement stock bricks", 1]], rating: 2, comment: "Some bricks were cracked and broke when we offloaded.", reply: "Sorry Mpho - send us a photo and we'll replace the broken ones." },
      { shop: "tumelo", buyer: "keabetswe", daysAgo: 25, items: [["Layer mash (chicken feed)", 2]], rating: 5, comment: "Tlhwatlhwa e kwa tlase, mme ba thusa ka bonako." },
      { shop: "tumelo", buyer: "ayanda", daysAgo: 30, items: [["Boer goat kid", 1]], rating: 5, comment: "Healthy goat kid, and the seller explained how to care for it." },
      { shop: "tumelo", buyer: "johan", daysAgo: 36, items: [["Cement", 6]], rating: 4, comment: "Fair price, but phone first to check they have stock." },
      { shop: "tumelo", buyer: "elsabe", daysAgo: 44, items: [["Lucerne bale", 2]], rating: 5, comment: "Altyd vriendelik en behulpsaam." },
      { shop: "tumelo", buyer: "gaone", daysAgo: 50, items: [["Point-of-lay hen", 3]], rating: 4, comment: "Good hens. It took a week before they started laying." },
      { shop: "tumelo", buyer: "riaan", daysAgo: 58, items: [["Cement stock bricks", 3]], rating: 5, comment: "Goeie stene teen 'n billike prys." },
      { shop: "tumelo", buyer: "kabelo", daysAgo: 64, items: [["Building sand", 4]], rating: 5, comment: "Quick and friendly service." },

      // Naledi's Beadwork: beautiful work; some find it pricey.
      { shop: "naledi", buyer: "customer", daysAgo: 8, items: [["Beaded bracelet", 1]], rating: 5, comment: "Beautiful beadwork, a perfect gift." },
      { shop: "naledi", buyer: "marike", daysAgo: 4, items: [["Beaded bracelet", 2]], rating: 5, comment: "Pragtige kralewerk, my dogters is mal daaroor." },
      { shop: "naledi", buyer: "lorato", daysAgo: 9, items: [["Beaded key ring", 3]], rating: 5, comment: "Lovely colours and strong thread. Friendly seller." },
      { shop: "naledi", buyer: "bontle", daysAgo: 14, items: [["Beaded bracelet", 1]], rating: 4, comment: "Mabenyane a mantle thata, mme a tura go se kae." },
      { shop: "naledi", buyer: "keabetswe", daysAgo: 19, items: [["Beaded key ring", 2]], rating: 5, comment: "Ke rekile tse pedi e le dimpho, mme botlhe ba di ratile." },
      { shop: "naledi", buyer: "ayanda", daysAgo: 27, items: [["Beaded bracelet", 1]], rating: 3, comment: "Nice bracelet but R120 is expensive." },
      { shop: "naledi", buyer: "elsabe", daysAgo: 35, items: [["Beaded bracelet", 1], ["Beaded key ring", 1]], rating: 5, comment: "Fyn werk en baie vriendelike diens." },
      { shop: "naledi", buyer: "onalenna", daysAgo: 42, items: [["Beaded key ring", 1]], rating: 2, comment: "The key ring broke after two weeks.", reply: "Sorry Onalenna! Bring it back and I'll restring it with stronger wire, free." },
      { shop: "naledi", buyer: "gaone", daysAgo: 55, items: [["Beaded bracelet", 1]], rating: 5, comment: "Handmade with love, you can see the quality." },
      { shop: "naledi", buyer: "refilwe", daysAgo: 63, items: [["Beaded key ring", 2]], rating: 4, comment: "Ready quickly, beautiful colours." },

      // Mma Kefilwe's Vegetable Stall (orders by SMS): fresh and cheap.
      { shop: "kefilwe", buyer: "kabelo", daysAgo: 1, items: [["Morogo (wild spinach)", 2]], rating: 5, comment: "Morogo o mosha thata, o kgethilwe maabane." },
      { shop: "kefilwe", buyer: "anna", daysAgo: 3, items: [["Butternut", 2]], rating: 5, comment: "Soet en vars botterskorsies teen 'n goeie prys." },
      { shop: "kefilwe", buyer: "mpho", daysAgo: 4, items: [["Green mealies", 2]], rating: 5, comment: "Fresh green mealies, cheap and sweet. Mma Kefilwe is so friendly." },
      { shop: "kefilwe", buyer: "tshepo", daysAgo: 6, items: [["Spinach bunch (stall)", 2]], rating: 4, comment: "Good spinach. The SMS took a while to confirm my order." },
      { shop: "kefilwe", buyer: "refilwe", daysAgo: 9, items: [["Morogo (wild spinach)", 1], ["Butternut", 1]], rating: 5, comment: "Ke rata go reka mo go Mma Kefilwe. Merogo e ntšha e bile tlhwatlhwa e siame." },
      { shop: "kefilwe", buyer: "karabo", daysAgo: 11, items: [["Green mealies", 1]], rating: 3, comment: "The mealies were a bit dry this time." },
      { shop: "kefilwe", buyer: "elsabe", daysAgo: 13, items: [["Spinach bunch (stall)", 1]], rating: 5, comment: "Die goedkoopste vars spinasie in die dorp." },
      { shop: "kefilwe", buyer: "olebogeng", daysAgo: 16, items: [["Morogo (wild spinach)", 2]], rating: 5, comment: "Fresh morogo, just like my grandmother used to cook." },
      { shop: "kefilwe", buyer: "lorato", daysAgo: 20, items: [["Butternut", 1]], rating: 4, comment: "Good butternut. The stall was closed when I came at 16:30, so check the hours." },
      { shop: "kefilwe", buyer: "kagiso", daysAgo: 23, items: [["Green mealies", 2]], rating: 5, comment: "Mmidi o ne o le monate e bile o le mosha. Ke tla boa." },
      { shop: "kefilwe", buyer: "gaone", daysAgo: 31, items: [["Spinach bunch (stall)", 2]], rating: 5, comment: "Cheap and fresh, and she always adds a little extra." },
      { shop: "kefilwe", buyer: "johan", daysAgo: 38, items: [["Butternut", 2]], rating: 2, comment: "One butternut was rotten inside.", reply: "Sorry Johan - Mma Kefilwe says come past the stall for a new one. (Tebogo)" },
      { shop: "kefilwe", buyer: "bontle", daysAgo: 46, items: [["Morogo (wild spinach)", 1]], rating: 5, comment: "Morogo o phepa, ga o na mmu." },
      { shop: "kefilwe", buyer: "keabetswe", daysAgo: 57, items: [["Green mealies", 1], ["Butternut", 1]], rating: 5, comment: "Mma Kefilwe always greets us with a smile and never overcharges." },
    ];
    for (const [i, r] of reviewed.entries()) {
      const key = `demo-review-${i + 1}`;
      const buyer = Number(userIds[r.buyer]);
      // Placed between 09:00 and 14:00, so the review (3 hours after collection) and any reply are in the past.
      orders.push({
        key,
        buyer,
        shop: shopIds[r.shop],
        status: "completed",
        at: localTime(daysAgoDate(r.daysAgo), 9 * 60 + ((i * 37) % 300)),
        items: r.items.map(([name, qty]) => ({ product: productIds[name], qty })),
      });
      if (r.rating) reviews.push({ key, buyer, rating: r.rating, comment: r.comment ?? null, reply: r.reply ?? null });
    }

    // 2. SYNTHETIC walk-in sales: per shop, the orders on an ordinary weekday, the opening hour, and for
    //    each product how popular it is (relative weight) and the most one customer buys.
    const walkIns: { shop: string; perDay: number; opens: number; closedOnSunday?: boolean; products: [string, number, number][] }[] = [
      { shop: "kgomotso", perDay: 4, opens: 8, products: [["Spinach bunch", 3, 3], ["Tomatoes", 3, 2], ["Brown bread", 3, 2], ["Vetkoek", 2, 2], ["Onions", 1, 1], ["Maize meal", 1, 1]] },
      { shop: "dineo", perDay: 6, opens: 10, products: [["Kota (quarter loaf)", 4, 2], ["Vetkoek with mince", 3, 3], ["Pap and beef stew", 2, 2], ["Magwinya (fat cakes)", 2, 2]] },
      { shop: "tumelo", perDay: 1.2, opens: 8, products: [["Cement", 3, 8], ["Building sand", 2, 10], ["Cement stock bricks", 1, 3], ["Lucerne bale", 2, 4], ["Layer mash (chicken feed)", 1, 2], ["Point-of-lay hen", 1, 6]] },
      { shop: "naledi", perDay: 0.4, opens: 9, products: [["Beaded bracelet", 1, 2], ["Beaded key ring", 1, 4]] },
      { shop: "kefilwe", perDay: 3, opens: 7, closedOnSunday: true, products: [["Morogo (wild spinach)", 3, 3], ["Green mealies", 2, 2], ["Butternut", 2, 2], ["Spinach bunch (stall)", 2, 2]] },
    ];
    let seed = 7; // a tiny fixed random generator, so every reset gives the same history
    const random = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    // How many orders arrive in a day when `mean` arrive on average (a Poisson draw, Knuth's method).
    const howMany = (mean: number) => {
      let n = 0;
      for (let p = random(); p > Math.exp(-mean); p *= random()) n++;
      return n;
    };
    // One product, the popular ones more often.
    const pick = (products: [string, number, number][]) => {
      let r = random() * products.reduce((sum, [, weight]) => sum + weight, 0);
      for (const product of products) {
        r -= product[1];
        if (r < 0) return product;
      }
      return products[products.length - 1];
    };
    const DAYS = 84; // 12 weeks, up to yesterday
    for (const shop of walkIns) {
      for (let daysAgo = DAYS; daysAgo >= 1; daysAgo--) {
        const day = daysAgoDate(daysAgo);
        const weekday = day.getUTCDay(); // 0 = Sunday
        if (weekday === 0 && shop.closedOnSunday) continue;
        const payday = day.getUTCDate() >= 25 || day.getUTCDate() <= 3;
        const growth = 0.8 + 0.4 * (1 - daysAgo / DAYS); // more people find the shop on the site each week
        const busy = (weekday === 5 || weekday === 6 ? 1.7 : weekday === 0 ? 0.6 : 1) * (payday ? 1.4 : 1) * growth;
        const count = howMany(shop.perDay * busy);
        for (let i = 0; i < count; i++) {
          const lines = new Map<number, number>(); // product id -> quantity
          const kinds = 1 + Math.floor(random() * Math.min(3, shop.products.length));
          for (let k = 0; k < kinds; k++) {
            const [name, , most] = pick(shop.products);
            lines.set(productIds[name], 1 + Math.floor(random() * most));
          }
          // A few orders weren't accepted: sold out (declined) or not answered in time (expired).
          const outcome = random();
          orders.push({
            key: `synthetic-${shop.shop}-${daysAgo}-${i}`,
            buyer: Number(userIds.history),
            shop: shopIds[shop.shop],
            status: outcome < 0.03 ? "expired" : outcome < 0.05 ? "declined" : "completed",
            at: localTime(day, shop.opens * 60 + Math.floor(random() * 9 * 60)),
            items: [...lines].map(([product, qty]) => ({ product, qty })),
          });
        }
      }
    }

    // Into the database in a few statements: each list goes as JSON, and PostgreSQL's jsonb_to_recordset
    // turns it into rows. One trip per table instead of thousands, so seeding the hosted database over
    // the internet stays quick.
    await client.query(
      `INSERT INTO orders (consumer_id, business_id, status, fulfilment, payment_method, subtotal_cents, total_cents,
                           accept_by, idempotency_key, request_hash, created_at, updated_at)
       SELECT x.buyer, x.shop, x.status, 'pickup', 'cash', x.subtotal, x.subtotal,
              t.placed + interval '30 minutes', x.key, repeat('0', 64), t.placed,
              t.placed + CASE x.status WHEN 'completed' THEN interval '60 minutes'
                                       WHEN 'declined' THEN interval '10 minutes' ELSE interval '30 minutes' END
         FROM jsonb_to_recordset($1::jsonb) AS x(key text, buyer bigint, shop bigint, status text, at timestamp, subtotal int)
        CROSS JOIN LATERAL (SELECT x.at AT TIME ZONE 'Africa/Johannesburg' AS placed) t
        ORDER BY t.placed`,
      [JSON.stringify(orders.map((o) => ({
        ...o,
        subtotal: o.items.reduce((sum, i) => sum + priceOf[i.product] * i.qty, 0),
      })))]
    );
    await client.query(
      `INSERT INTO order_items (order_id, product_id, product_name, unit_label, unit_price_cents, quantity, line_total_cents)
       SELECT o.id, p.id, p.name, p.unit_label, p.price_cents, x.qty, p.price_cents * x.qty
         FROM jsonb_to_recordset($1::jsonb) AS x(key text, buyer bigint, product bigint, qty int)
         JOIN orders o ON o.idempotency_key = x.key AND o.consumer_id = x.buyer
         JOIN products p ON p.id = x.product`,
      [JSON.stringify(orders.flatMap((o) => o.items.map((i) => ({ key: o.key, buyer: o.buyer, ...i }))))]
    );
    // The same steps a real order goes through, each recorded (business rule 8).
    await client.query(
      `INSERT INTO order_status_history (order_id, from_status, to_status, changed_by, reason, created_at)
       SELECT o.id, s.from_status, s.to_status,
              CASE s.actor WHEN 'customer' THEN o.consumer_id WHEN 'seller' THEN b.owner_id END,
              COALESCE(s.reason, CASE WHEN o.idempotency_key LIKE 'synthetic-%' THEN 'Synthetic demo history' END),
              o.created_at + s.delay
         FROM orders o
         JOIN businesses b ON b.id = o.business_id
         JOIN (VALUES
           ('completed', NULL, 'pending_acceptance', 'customer', NULL, interval '0 minutes'),
           ('completed', 'pending_acceptance', 'confirmed', 'seller', NULL, interval '6 minutes'),
           ('completed', 'confirmed', 'ready', 'seller', NULL, interval '25 minutes'),
           ('completed', 'ready', 'completed', 'seller', NULL, interval '60 minutes'),
           ('declined', NULL, 'pending_acceptance', 'customer', NULL, interval '0 minutes'),
           ('declined', 'pending_acceptance', 'declined', 'seller', 'Sold out for today', interval '10 minutes'),
           ('expired', NULL, 'pending_acceptance', 'customer', NULL, interval '0 minutes'),
           ('expired', 'pending_acceptance', 'expired', NULL, 'Seller did not respond in time', interval '30 minutes')
         ) AS s(status, from_status, to_status, actor, reason, delay) ON s.status = o.status
        ORDER BY o.created_at, s.delay`
    );
    // Paid in cash when collected: the seller received it all.
    await client.query(
      `INSERT INTO cash_receipts (order_id, collected_by, collected_cents, remitted_cents, collected_at, remitted_at, status, acknowledged_by)
       SELECT o.id, b.owner_id, o.total_cents, o.total_cents, o.updated_at, o.updated_at, 'remitted', b.owner_id
         FROM orders o JOIN businesses b ON b.id = o.business_id
        WHERE o.status = 'completed'`
    );
    // The shops joined before their first sale ("selling here since ..." on the shop page). Shops made
    // during the demo, e.g. by approving Boitumelo's application, are then the "new this week" ones.
    for (const [shop, monthsAgo] of [["kgomotso", 6], ["dineo", 5], ["tumelo", 4], ["naledi", 4], ["kefilwe", 3]] as [string, number][]) {
      await client.query("UPDATE businesses SET created_at = now() - make_interval(months => $2) WHERE id = $1", [shopIds[shop], monthsAgo]);
    }
    // Reviews: written 3 hours after collecting; the seller's reply 4 hours after that.
    await client.query(
      `INSERT INTO reviews (order_id, business_id, consumer_id, rating, comment, seller_reply, seller_replied_at, created_at)
       SELECT o.id, o.business_id, o.consumer_id, x.rating, x.comment, x.reply,
              CASE WHEN x.reply IS NOT NULL THEN o.updated_at + interval '7 hours' END, o.updated_at + interval '3 hours'
         FROM jsonb_to_recordset($1::jsonb) AS x(key text, buyer bigint, rating int, comment text, reply text)
         JOIN orders o ON o.idempotency_key = x.key AND o.consumer_id = x.buyer
        ORDER BY o.created_at`,
      [JSON.stringify(reviews)]
    );

    await client.query("COMMIT");
    console.log("Demo data added.");
    // A private SEED_PASSPHRASE is never printed - terminals get screenshotted and logged.
    console.log(
      process.env.SEED_PASSPHRASE
        ? "Demo logins (passphrase for all: the SEED_PASSPHRASE you set):"
        : `Demo logins (passphrase for all: ${DEMO_PASSPHRASE}):`
    );
    for (const [, phone, name] of users) console.log(`  ${phone}  ${name}`);
    console.log(`  +27710000101 to +27710000116  ${reviewers.length} more demo customers who wrote the reviews`);
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
