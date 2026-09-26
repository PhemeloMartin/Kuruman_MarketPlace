import crypto from "crypto";
import { NextFunction, Request, Response } from "express";
import { pool } from "../db";

export type Role = "consumer" | "entrepreneur" | "courier" | "support";
export type StaffScope = "approvals" | "payments" | "operations" | "audit" | "privacy";

export interface SessionUser {
  id: number;
  phone: string;
  displayName: string;
  role: Role;
  preferredLanguage: string;
  staffScopes: StaffScope[]; // empty for everyone except support
  mfaVerified: boolean; // support: this session passed the authenticator-code step
}

// Lets TypeScript know that requireAuth puts the logged-in user on req.user.
declare global {
  namespace Express {
    interface Request {
      user?: SessionUser;
      sessionTokenHash?: string;
    }
  }
}

export const SESSION_COOKIE = "kmp_session";
const IDLE_LIMIT_MINUTES = 30; // spec 9.2: log out after 30 min without activity
const ABSOLUTE_LIMIT_HOURS = 12; // ...and always after 12 hours

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

// Creates a session row and sets the cookie. The raw token only ever lives in the cookie.
export async function startSession(res: Response, userId: number): Promise<void> {
  const token = crypto.randomBytes(32).toString("base64url");
  await pool.query(
    `INSERT INTO sessions (user_id, token_hash, expires_at)
     VALUES ($1, $2, now() + make_interval(hours => $3))`,
    [userId, hashToken(token), ABSOLUTE_LIMIT_HOURS]
  );
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true, // JavaScript in the page can't read it, so an XSS bug can't steal it
    sameSite: "lax", // not sent on cross-site form posts (CSRF protection)
    secure: process.env.NODE_ENV === "production", // HTTPS-only once hosted
    maxAge: ABSOLUTE_LIMIT_HOURS * 60 * 60 * 1000,
    path: "/",
  });
}

export async function endSession(req: Request, res: Response): Promise<void> {
  const token = req.cookies?.[SESSION_COOKIE];
  if (token) await pool.query("DELETE FROM sessions WHERE token_hash = $1", [hashToken(token)]);
  res.clearCookie(SESSION_COOKIE, { path: "/" });
}

// Looks up the cookie's session. If it is valid, puts the user on req.user.
// Never rejects the request itself - requireAuth / requireRole decide that.
export async function loadSession(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return next();

  const tokenHash = hashToken(token);
  const r = await pool.query(
    `SELECT u.id, u.phone, u.display_name, u.role, u.preferred_language, u.staff_scopes,
            s.mfa_verified_at IS NOT NULL AS mfa_verified
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1
        AND s.expires_at > now()
        AND s.last_seen_at > now() - make_interval(mins => $2)
        AND u.is_active`,
    [tokenHash, IDLE_LIMIT_MINUTES]
  );
  if (r.rowCount === 0) return next();

  const u = r.rows[0];
  req.user = {
    id: Number(u.id),
    phone: u.phone,
    displayName: u.display_name,
    role: u.role,
    preferredLanguage: u.preferred_language,
    staffScopes: u.staff_scopes,
    mfaVerified: u.mfa_verified,
  };
  req.sessionTokenHash = tokenHash;

  // Activity keeps the session alive (sliding idle window).
  await pool.query("UPDATE sessions SET last_seen_at = now() WHERE token_hash = $1", [tokenHash]);
  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: "Please sign in first." });
  next();
}

// The role comes from our database via the session, never from the browser.
export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: "Please sign in first." });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: "Your account can't do this." });
    }
    next();
  };
}

// Support console guard (spec FR-21, TC-21). Three separate checks, in order:
//   1. the account is support staff (set up in the database - nobody can sign up as support);
//   2. THIS session passed the authenticator-code step (a stolen passphrase alone isn't enough);
//   3. the staff member holds the scope for this kind of work.
export function requireStaff(scope?: StaffScope) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: "Please sign in first." });
    if (req.user.role !== "support") return res.status(403).json({ error: "Your account can't do this." });
    if (!req.user.mfaVerified) {
      return res.status(403).json({ error: "Enter the code from your authenticator app first.", code: "mfa_required" });
    }
    if (scope && !req.user.staffScopes.includes(scope)) {
      return res.status(403).json({ error: "Your support role doesn't cover this kind of case.", code: "scope" });
    }
    next();
  };
}
