import { Router } from "express";
import { pool } from "../db";
import { requireAuth, requireStaff } from "../auth/session";
import { audit } from "../lib/audit";
import { enqueue } from "../lib/outbox";

// Help tickets, like a support centre: anyone signed in opens a ticket on the site and follows it there -
// its number, its status and the conversation with support. No email address is needed: when support
// answers, the person gets an in-app notification and an SMS (lib/notificationWorker.ts).
//
//   open     = waiting for support        answered = support replied, waiting for the person
//   closed   = done (either side closed it)
//
// People see only their own tickets. Support sees the person's name and role - not their phone number:
// the answer goes in the ticket.
export const ticketsRouter = Router();

export const TICKET_TOPICS = ["order", "selling", "payment", "account", "other"];
const MAX_OPEN_TICKETS = 5; // per person, so the queue can't be flooded

const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");

function messageFrom(body: any): string | null {
  const m = text(body?.message);
  return m.length >= 5 && m.length <= 2000 ? m : null;
}

async function messagesOf(ticketId: number) {
  const r = await pool.query(
    `SELECT m.id, m.from_support, m.body, m.created_at, split_part(u.display_name, ' ', 1) AS author
       FROM ticket_messages m JOIN users u ON u.id = m.author_id
      WHERE m.ticket_id = $1 ORDER BY m.id`,
    [ticketId]
  );
  return r.rows.map((m) => ({
    id: Number(m.id),
    fromSupport: m.from_support,
    // People see "KurumanMarketPlace support"; staff see who answered.
    author: m.author,
    body: m.body,
    at: m.created_at,
  }));
}

const ticketJson = (t: any) => ({
  id: Number(t.id),
  topic: t.topic,
  subject: t.subject,
  status: t.status,
  createdAt: t.created_at,
  updatedAt: t.updated_at,
  closedAt: t.closed_at,
});

// ---- The person's side ----

// GET /api/tickets - my tickets, the most recently updated first.
ticketsRouter.get("/tickets", requireAuth, async (req, res) => {
  const r = await pool.query("SELECT * FROM tickets WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 50", [req.user!.id]);
  res.json(r.rows.map(ticketJson));
});

// POST /api/tickets { topic, subject, message }
ticketsRouter.post("/tickets", requireAuth, async (req, res) => {
  const topic = text(req.body?.topic);
  const subject = text(req.body?.subject);
  const message = messageFrom(req.body);
  const fields: Record<string, string> = {};
  if (!TICKET_TOPICS.includes(topic)) fields.topic = "Choose what it's about.";
  if (subject.length < 4 || subject.length > 120) fields.subject = "Write a short title (4 to 120 characters).";
  if (!message) fields.message = "Describe the problem (5 to 2000 characters).";
  if (Object.keys(fields).length) return res.status(422).json({ error: "Please check the highlighted fields.", fields });

  const open = await pool.query("SELECT count(*)::int AS n FROM tickets WHERE user_id = $1 AND status <> 'closed'", [req.user!.id]);
  if (open.rows[0].n >= MAX_OPEN_TICKETS) {
    return res.status(409).json({ error: `You have ${MAX_OPEN_TICKETS} open tickets. Please wait for an answer, or close one first.` });
  }
  const client = await pool.connect();
  let id: number;
  try {
    await client.query("BEGIN");
    const t = await client.query("INSERT INTO tickets (user_id, topic, subject) VALUES ($1, $2, $3) RETURNING id", [req.user!.id, topic, subject]);
    id = Number(t.rows[0].id);
    await client.query("INSERT INTO ticket_messages (ticket_id, author_id, from_support, body) VALUES ($1, $2, FALSE, $3)", [id, req.user!.id, message]);
    await audit(client, { actorId: req.user!.id, action: "ticket.open", resourceType: "ticket", resourceId: id, outcome: "success" });
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
  res.status(201).json({ id });
});

// GET /api/tickets/:id - one of MY tickets, with the conversation. Someone else's is "not found".
ticketsRouter.get("/tickets/:id", requireAuth, async (req, res) => {
  const t = await pool.query("SELECT * FROM tickets WHERE id = $1 AND user_id = $2", [Number(req.params.id) || 0, req.user!.id]);
  if (t.rowCount === 0) return res.status(404).json({ error: "Ticket not found." });
  const messages = (await messagesOf(Number(t.rows[0].id))).map((m) => ({ ...m, author: m.fromSupport ? "KurumanMarketPlace support" : "You" }));
  res.json({ ...ticketJson(t.rows[0]), messages });
});

// POST /api/tickets/:id/messages { message } - the person adds to their ticket: it waits for support again.
ticketsRouter.post("/tickets/:id/messages", requireAuth, async (req, res) => {
  const message = messageFrom(req.body);
  if (!message) return res.status(422).json({ error: "Write your message (5 to 2000 characters).", fields: { message: "5 to 2000 characters." } });
  const t = await pool.query(
    "UPDATE tickets SET status = 'open', updated_at = now() WHERE id = $1 AND user_id = $2 AND status <> 'closed' RETURNING id",
    [Number(req.params.id) || 0, req.user!.id]
  );
  if (t.rowCount === 0) return res.status(409).json({ error: "This ticket is closed. Open a new one if you still need help." });
  await pool.query("INSERT INTO ticket_messages (ticket_id, author_id, from_support, body) VALUES ($1, $2, FALSE, $3)", [t.rows[0].id, req.user!.id, message]);
  res.status(201).json({ ok: true });
});

// POST /api/tickets/:id/close - "my problem is solved".
ticketsRouter.post("/tickets/:id/close", requireAuth, async (req, res) => {
  const t = await pool.query(
    "UPDATE tickets SET status = 'closed', closed_at = now(), updated_at = now() WHERE id = $1 AND user_id = $2 AND status <> 'closed' RETURNING id",
    [Number(req.params.id) || 0, req.user!.id]
  );
  if (t.rowCount === 0) return res.status(409).json({ error: "This ticket is already closed." });
  res.json({ ok: true });
});

// ---- Support's side (any support staff) ----

// GET /api/support/tickets - waiting for support first (oldest first), then answered, then recent closed.
ticketsRouter.get("/support/tickets", requireStaff(), async (_req, res) => {
  const r = await pool.query(
    `(SELECT t.*, u.display_name, u.role FROM tickets t JOIN users u ON u.id = t.user_id WHERE t.status = 'open' ORDER BY t.updated_at)
     UNION ALL
     (SELECT t.*, u.display_name, u.role FROM tickets t JOIN users u ON u.id = t.user_id WHERE t.status = 'answered' ORDER BY t.updated_at DESC)
     UNION ALL
     (SELECT t.*, u.display_name, u.role FROM tickets t JOIN users u ON u.id = t.user_id WHERE t.status = 'closed' ORDER BY t.closed_at DESC LIMIT 20)`
  );
  res.json(r.rows.map((t) => ({ ...ticketJson(t), person: { name: t.display_name, role: t.role } })));
});

// GET /api/support/tickets/:id - the whole conversation, with who in support answered.
ticketsRouter.get("/support/tickets/:id", requireStaff(), async (req, res) => {
  const t = await pool.query(
    "SELECT t.*, u.display_name, u.role FROM tickets t JOIN users u ON u.id = t.user_id WHERE t.id = $1",
    [Number(req.params.id) || 0]
  );
  if (t.rowCount === 0) return res.status(404).json({ error: "Ticket not found." });
  res.json({ ...ticketJson(t.rows[0]), person: { name: t.rows[0].display_name, role: t.rows[0].role }, messages: await messagesOf(Number(t.rows[0].id)) });
});

// POST /api/support/tickets/:id/messages { message, close? } - support answers. The person gets a
// notification and an SMS. close: true also closes the ticket ("answered and done").
ticketsRouter.post("/support/tickets/:id/messages", requireStaff(), async (req, res) => {
  const message = messageFrom(req.body);
  if (!message) return res.status(422).json({ error: "Write your answer (5 to 2000 characters).", fields: { message: "5 to 2000 characters." } });
  const close = req.body?.close === true;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const t = await client.query(
      `UPDATE tickets SET status = $2::varchar, updated_at = now(), closed_at = CASE WHEN $2::varchar = 'closed' THEN now() END
        WHERE id = $1 AND status <> 'closed' RETURNING id, user_id, subject`,
      [Number(req.params.id) || 0, close ? "closed" : "answered"]
    );
    if (t.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "This ticket is closed." });
    }
    const ticket = t.rows[0];
    const m = await client.query(
      "INSERT INTO ticket_messages (ticket_id, author_id, from_support, body) VALUES ($1, $2, TRUE, $3) RETURNING id",
      [ticket.id, req.user!.id, message]
    );
    await enqueue(client, {
      type: "ticket.answered",
      aggregateId: Number(ticket.id),
      dedupeKey: `ticket-message:${m.rows[0].id}`, // one answer = one notification
      payload: { userId: Number(ticket.user_id), ticketId: Number(ticket.id), subject: ticket.subject },
    });
    await audit(client, {
      actorId: req.user!.id,
      action: close ? "ticket.answer_and_close" : "ticket.answer",
      resourceType: "ticket",
      resourceId: Number(ticket.id),
      outcome: "success",
    });
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
  res.status(201).json({ ok: true });
});
