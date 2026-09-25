import { Router } from "express";
import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";
import { pool } from "../db";
import { normaliseSaPhone } from "../lib/phone";
import { endSession, startSession } from "../auth/session";

export const authRouter = Router();

// Spec 7.3: passphrases of 15-128 characters, spaces allowed, no "must contain a symbol" rules.
const MIN_PASSPHRASE = 15;
const MAX_PASSPHRASE = 128;
const LANGUAGES = ["en", "tn", "af"];

// Slows down password guessing: 10 attempts per 15 minutes per IP address.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many attempts. Please wait 15 minutes and try again." },
});

// Used when the phone number isn't registered, so a login takes the same time either way
// and an attacker can't tell which numbers have accounts.
const DUMMY_HASH = bcrypt.hashSync("not-a-real-passphrase-placeholder", 10);

function publicUser(u: { id: string | number; phone: string; display_name: string; role: string; preferred_language: string }) {
  return {
    id: Number(u.id),
    phone: u.phone,
    displayName: u.display_name,
    role: u.role,
    preferredLanguage: u.preferred_language,
  };
}

// Everyone signs up as a consumer. Seller and courier access are approved later (spec FR-02),
// so any "role" the browser sends is ignored.
authRouter.post("/register", authLimiter, async (req, res) => {
  const { phone, displayName, passphrase, preferredLanguage } = req.body ?? {};
  const fields: Record<string, string> = {};

  const normalPhone = typeof phone === "string" ? normaliseSaPhone(phone) : null;
  if (!normalPhone) fields.phone = "Enter a South African phone number, e.g. 071 234 5678.";

  const name = typeof displayName === "string" ? displayName.trim() : "";
  if (name.length < 2 || name.length > 80) fields.displayName = "Enter your name (2 to 80 characters).";

  if (typeof passphrase !== "string" || passphrase.length < MIN_PASSPHRASE || passphrase.length > MAX_PASSPHRASE) {
    fields.passphrase = `Use at least ${MIN_PASSPHRASE} characters. A short sentence works well.`;
  }

  const language = LANGUAGES.includes(preferredLanguage) ? preferredLanguage : "en";

  if (Object.keys(fields).length > 0) {
    return res.status(422).json({ error: "Please check the highlighted fields.", fields });
  }

  const hash = await bcrypt.hash(passphrase, 10);
  const r = await pool.query(
    `INSERT INTO users (phone, display_name, password_hash, role, preferred_language)
     VALUES ($1, $2, $3, 'consumer', $4)
     ON CONFLICT (phone) DO NOTHING
     RETURNING id, phone, display_name, role, preferred_language`,
    [normalPhone, name, hash, language]
  );
  if (r.rowCount === 0) {
    return res.status(409).json({
      error: "This phone number can't be used to register. Try signing in instead.",
      fields: { phone: "Already registered." },
    });
  }

  await startSession(res, Number(r.rows[0].id));
  res.status(201).json({ user: publicUser(r.rows[0]) });
});

authRouter.post("/login", authLimiter, async (req, res) => {
  const { phone, passphrase } = req.body ?? {};
  const normalPhone = typeof phone === "string" ? normaliseSaPhone(phone) : null;
  const given = typeof passphrase === "string" ? passphrase : "";

  const r = normalPhone
    ? await pool.query(
        `SELECT id, phone, display_name, role, preferred_language, password_hash, is_active
           FROM users WHERE phone = $1`,
        [normalPhone]
      )
    : { rows: [] as any[] };
  const user = r.rows[0];

  const passwordOk = await bcrypt.compare(given, user?.password_hash ?? DUMMY_HASH);
  if (!user || !passwordOk || !user.is_active) {
    // Same message whatever went wrong, so it doesn't reveal whether the number exists.
    return res.status(401).json({ error: "Phone number or passphrase is incorrect." });
  }

  await startSession(res, Number(user.id));
  res.json({ user: publicUser(user) });
});

authRouter.post("/logout", async (req, res) => {
  await endSession(req, res);
  res.status(204).end();
});

// The app calls this on start-up to find out who (if anyone) is signed in.
// Not being signed in is a normal answer here (user: null), not an error.
authRouter.get("/me", (req, res) => {
  res.json({ user: req.user ?? null });
});
