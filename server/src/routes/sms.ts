import crypto from "crypto";
import { Router } from "express";
import { pool } from "../db";
import { normaliseSaPhone } from "../lib/phone";
import { SMS_DEMO_SHOW_CODES } from "../lib/sms";
import { handleInboundSms } from "../lib/smsOrders";

// SMS coming IN, and the demo "basic phone" page.
export const smsRouter = Router();

// POST /api/sms/inbound?token=... { from, text }
// The SMS gateway calls this when someone replies to one of our messages. The secret token in the
// address (SMS_INBOUND_TOKEN, also set in the gateway's dashboard) proves the call really comes from
// the gateway. Each gateway names its fields a little differently; this accepts the common names.
smsRouter.post("/sms/inbound", async (req, res) => {
  const expected = process.env.SMS_INBOUND_TOKEN ?? "";
  const given = typeof req.query.token === "string" ? req.query.token : "";
  const ok = expected.length >= 16 && given.length === expected.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
  if (!ok) return res.status(403).json({ error: "Not allowed." });
  // BulkSMS sends a list of messages; other gateways send one. Field names differ a little too.
  const messages = Array.isArray(req.body) ? req.body : [req.body ?? {}];
  for (const m of messages.slice(0, 20)) {
    const from = String(m?.from ?? m?.sourceAddress ?? m?.msisdn ?? "");
    const text = String(m?.body ?? m?.text ?? m?.message ?? "");
    if (from && text) await handleInboundSms(from, text);
  }
  res.json({ ok: true });
});

// ---- Demo only (SMS_DEMO_SHOW_CODES=true, made-up accounts): a pretend basic phone ----

function demoOnly(res: any): boolean {
  if (SMS_DEMO_SHOW_CODES) return true;
  res.status(404).json({ error: "Not found." });
  return false;
}

// GET /api/demo/phone?number=0710000014 - the SMS that number sent and received.
smsRouter.get("/demo/phone", async (req, res) => {
  if (!demoOnly(res)) return;
  const phone = normaliseSaPhone(String(req.query.number ?? ""));
  if (!phone) return res.status(422).json({ error: "Enter a South African phone number." });
  const r = await pool.query(
    "SELECT id, direction, body, created_at FROM sms_messages WHERE phone = $1 ORDER BY id DESC LIMIT 30",
    [phone]
  );
  res.json(r.rows.reverse().map((m) => ({ id: Number(m.id), direction: m.direction, body: m.body, at: m.created_at })));
});

// POST /api/demo/phone { number, text } - "send an SMS" from that pretend phone.
smsRouter.post("/demo/phone", async (req, res) => {
  if (!demoOnly(res)) return;
  const text = String(req.body?.text ?? "").trim().slice(0, 160);
  if (!text) return res.status(422).json({ error: "Type a message." });
  const reply = await handleInboundSms(String(req.body?.number ?? ""), text);
  if (!reply) return res.status(422).json({ error: "Enter a South African phone number." });
  res.json({ reply: reply.text });
});
