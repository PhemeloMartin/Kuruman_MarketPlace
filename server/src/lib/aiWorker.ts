import { pool } from "../db";
import { analyseReviews, screenText } from "./aiClient";

// Runs the AI over new content in the background, so nobody waits for it:
//   1. reviews without a sentiment yet -> sentiment and themes ("Customers mention: fresh (5)")
//   2. texts not yet screened in their current version (product names and descriptions, shop
//      "about" texts, review comments) -> the off-platform / scam detector
// A flagged text goes on support's "Flagged for review" list. Nothing is hidden automatically:
// a person decides (spec BR-14: AI advises, people decide).

const BATCH = 30;

export async function runAiWorker(): Promise<{ analysed: number; screened: number; flagged: number }> {
  let analysed = 0;
  let screened = 0;
  let flagged = 0;

  const reviews = await pool.query(
    `SELECT id, comment FROM reviews WHERE ai_model_version IS NULL AND comment IS NOT NULL ORDER BY id LIMIT $1`,
    [BATCH]
  );
  if (reviews.rowCount) {
    const r = await analyseReviews(reviews.rows.map((x) => x.comment));
    if (r) {
      for (const [i, row] of reviews.rows.entries()) {
        await pool.query("UPDATE reviews SET sentiment = $2, themes = $3, ai_model_version = $4 WHERE id = $1", [
          row.id,
          r.results[i].sentiment,
          r.results[i].themes,
          r.modelVersion,
        ]);
        analysed++;
      }
    }
  }

  // Each text with a fingerprint (SHA-256) of its current wording; already-screened versions are skipped.
  const texts = await pool.query(
    `WITH items AS (
       SELECT 'product' AS item_type, p.id AS item_id, concat_ws('. ', p.name, p.description) AS text
         FROM products p WHERE p.is_active
       UNION ALL
       SELECT 'shop', b.id, b.description FROM businesses b WHERE b.description IS NOT NULL
       UNION ALL
       SELECT 'review', rv.id, rv.comment FROM reviews rv WHERE rv.comment IS NOT NULL AND rv.hidden_at IS NULL
     ),
     hashed AS (SELECT i.*, encode(sha256(convert_to(i.text, 'UTF8')), 'hex') AS text_hash FROM items i)
     SELECT h.* FROM hashed h
      WHERE NOT EXISTS (SELECT 1 FROM screenings s
                         WHERE s.item_type = h.item_type AND s.item_id = h.item_id AND s.text_hash = h.text_hash)
      LIMIT $1`,
    [BATCH]
  );
  for (const t of texts.rows) {
    const s = await screenText(t.text);
    if (!s) break; // service down: try again next round
    await pool.query(
      `INSERT INTO screenings (item_type, item_id, text_hash, flagged, excerpt, score, reasons, model_version)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT DO NOTHING`,
      [t.item_type, t.item_id, t.text_hash, s.flag, s.flag ? String(t.text).slice(0, 500) : null, s.score, s.reasons, s.modelVersion]
    );
    screened++;
    if (s.flag) flagged++;
  }
  return { analysed, screened, flagged };
}

// Every minute while the server runs (only when an AI service is configured). AI_WORKER=off stops it.
export function startAiWorker(): void {
  if (process.env.AI_WORKER === "off" || !process.env.AI_SERVICE_URL) return;
  const tick = () =>
    runAiWorker()
      .then((n) => {
        if (n.analysed || n.screened) {
          console.log(`AI worker: ${n.analysed} reviews analysed, ${n.screened} texts screened, ${n.flagged} flagged`);
        }
      })
      .catch((err) => console.error("AI worker failed:", err?.message ?? err));
  setTimeout(tick, 10_000);
  setInterval(tick, 60_000);
}
