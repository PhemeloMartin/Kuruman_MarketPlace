import { Router } from "express";
import { pool } from "../db";
import { requireAuth } from "../auth/session";

// A person's own in-app notifications (spec FR-17). Mounted at /api/notifications.
// Every query is limited to req.user - nobody can read or mark someone else's.
export const notificationsRouter = Router();
notificationsRouter.use(requireAuth);

// GET /api/notifications/unread-count - cheap enough to ask every 30 seconds for the badge.
notificationsRouter.get("/unread-count", async (req, res) => {
  const r = await pool.query("SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL", [req.user!.id]);
  res.json({ unread: r.rows[0].n });
});

// GET /api/notifications - the latest 50.
notificationsRouter.get("/", async (req, res) => {
  const r = await pool.query(
    `SELECT id, order_id, template_key, arguments, created_at, read_at
       FROM notifications WHERE user_id = $1 ORDER BY id DESC LIMIT 50`,
    [req.user!.id]
  );
  res.json(
    r.rows.map((n) => ({
      id: Number(n.id),
      orderId: n.order_id === null ? null : Number(n.order_id),
      template: n.template_key,
      args: n.arguments,
      createdAt: n.created_at,
      read: n.read_at !== null,
    }))
  );
});

// POST /api/notifications/read-all - mark everything I've seen as read.
notificationsRouter.post("/read-all", async (req, res) => {
  await pool.query("UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL", [req.user!.id]);
  res.status(204).end();
});
