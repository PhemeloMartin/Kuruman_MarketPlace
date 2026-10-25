import { Router } from "express";
import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";
import { pool } from "../db";
import { normaliseSaPhone } from "../lib/phone";
import { endSession, startSession } from "../auth/session";
import { audit } from "../lib/audit";
import { RESEND_AFTER_SECONDS, checkCode, issueCode, useCode } from "../lib/phoneCodes";
import { SMS_DEMO_SHOW_CODES } from "../lib/sms";

export const authRouter = Router();

const LANGUAGES = ["en", "tn", "af"];

// Slows down guessing (codes and passphrases): 10 attempts per 15 minutes per IP address.
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

function publicUser(u: {
  id: string | number;
  phone: string;
  display_name: string;
  role: string;
  preferred_language: string;
  staff_scopes?: string[];
}) {
  return {
    id: Number(u.id),
    phone: u.phone,
    displayName: u.display_name,
    role: u.role,
    preferredLanguage: u.preferred_language,
    staffScopes: u.staff_scopes ?? [],
    mfaVerified: false, // a brand-new session never starts verified
  };
}

// Signing in with an SMS code, like WhatsApp: there is no passphrase to remember or forget.
//   1. POST /auth/code         { phone }                 -> we send a 6-digit code by SMS
//   2. POST /auth/code/verify  { phone, code }           -> signed in
//      A new number has no account yet: the answer is { needsName: true }, and the person sends the
//      same code again with their name: { phone, code, displayName } -> account created, signed in.
// Both answers are the same whether or not the number has an account, so nobody can use this to
// find out who is registered.
authRouter.post("/code", authLimiter, async (req, res) => {
  const phone = typeof req.body?.phone === "string" ? normaliseSaPhone(req.body.phone) : null;
  if (!phone) {
    return res.status(422).json({
      error: "Enter a South African phone number, e.g. 071 234 5678.",
      fields: { phone: "Enter a South African phone number." },
    });
  }
  const issued = await issueCode(phone, "sign_in");
  if (!issued.ok) {
    return res.status(429).json({
      error:
        issued.waitSeconds > 120
          ? "Too many codes for this number. Please try again in an hour."
          : `A code was sent a moment ago. You can ask for a new one in ${issued.waitSeconds} seconds.`,
      waitSeconds: issued.waitSeconds,
    });
  }
  res.json({
    sent: true,
    resendAfterSeconds: RESEND_AFTER_SECONDS,
    ...(SMS_DEMO_SHOW_CODES ? { demoCode: issued.code } : {}),
  });
});

// Everyone signs up as a consumer. Seller and courier access are approved later (spec FR-02),
// so any "role" the browser sends is ignored.
authRouter.post("/code/verify", authLimiter, async (req, res) => {
  const phone = typeof req.body?.phone === "string" ? normaliseSaPhone(req.body.phone) : null;
  if (!phone) return res.status(422).json({ error: "Enter a South African phone number, e.g. 071 234 5678." });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const check = await checkCode(client, phone, "sign_in", req.body?.code);
    if (!check.ok) {
      await client.query("COMMIT"); // keep the counted wrong try
      return res.status(check.status).json({ error: check.error, fields: { code: check.error } });
    }

    const found = await client.query(
      `SELECT id, phone, display_name, role, preferred_language, staff_scopes, is_active
         FROM users WHERE phone = $1`,
      [phone]
    );
    let user = found.rows[0];

    if (user?.role === "support") {
      // Staff can see everyone's details, so they need the stronger sign-in (passphrase + app).
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "Support staff sign in with their passphrase and authenticator app." });
    }
    if (user && !user.is_active) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "This account can't sign in at the moment. Please contact support." });
    }

    if (!user) {
      const name = typeof req.body?.displayName === "string" ? req.body.displayName.trim() : "";
      if (!name) {
        // The code was right; keep it unused so the same code works with the name.
        await client.query("ROLLBACK");
        return res.json({ needsName: true });
      }
      if (name.length < 2 || name.length > 80) {
        await client.query("ROLLBACK");
        return res.status(422).json({
          error: "Please check your name.",
          fields: { displayName: "Enter your name (2 to 80 characters)." },
        });
      }
      const language = LANGUAGES.includes(req.body?.preferredLanguage) ? req.body.preferredLanguage : "en";
      const created = await client.query(
        `INSERT INTO users (phone, display_name, role, preferred_language)
         VALUES ($1, $2, 'consumer', $3)
         RETURNING id, phone, display_name, role, preferred_language, staff_scopes`,
        [phone, name, language]
      );
      user = created.rows[0];
    }

    await useCode(client, check.codeId);
    await client.query("COMMIT");

    await startSession(res, Number(user.id), user.role);
    await audit(pool, { actorId: Number(user.id), action: "auth.login", resourceType: "user", resourceId: user.id, outcome: "success" });
    res.status(found.rowCount === 0 ? 201 : 200).json({ user: publicUser(user) });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
});

// Passphrase sign-in: for support staff (followed by the authenticator-app step), and the demo
// accounts the automated tests use. Accounts made with an SMS code have no passphrase, so this
// route can't open them.
authRouter.post("/login", authLimiter, async (req, res) => {
  const { phone, passphrase } = req.body ?? {};
  const normalPhone = typeof phone === "string" ? normaliseSaPhone(phone) : null;
  const given = typeof passphrase === "string" ? passphrase : "";

  const r = normalPhone
    ? await pool.query(
        `SELECT id, phone, display_name, role, preferred_language, staff_scopes, password_hash, is_active
           FROM users WHERE phone = $1`,
        [normalPhone]
      )
    : { rows: [] as any[] };
  const user = r.rows[0];

  const passwordOk = await bcrypt.compare(given, user?.password_hash ?? DUMMY_HASH);
  if (!user || !passwordOk || !user.is_active) {
    // Recorded against the account only when it exists; the phone number itself isn't logged.
    if (user) {
      await audit(pool, { actorId: null, action: "auth.login", resourceType: "user", resourceId: user.id, outcome: "failed" });
    }
    // Same message whatever went wrong, so it doesn't reveal whether the number exists.
    return res.status(401).json({ error: "Phone number or passphrase is incorrect." });
  }

  await startSession(res, Number(user.id), user.role);
  await audit(pool, { actorId: Number(user.id), action: "auth.login", resourceType: "user", resourceId: user.id, outcome: "success" });
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
