import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { id, parse } from '../utils/validate.js';

const router = Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  const items = req.db
    .prepare(
      `SELECT n.id, n.message, n.is_read AS isRead, n.booking_id AS bookingId, n.shop_id AS shopId,
              n.created_at AS createdAt, s.name AS shopName
       FROM notifications n LEFT JOIN shops s ON s.id = n.shop_id
       WHERE n.user_id = ? ORDER BY n.id DESC LIMIT 30`,
    )
    .all(req.user.id)
    .map((n) => ({ ...n, isRead: Boolean(n.isRead) }));
  const { unread } = req.db
    .prepare('SELECT COUNT(*) AS unread FROM notifications WHERE user_id = ? AND is_read = 0')
    .get(req.user.id);
  res.json({ unread, items });
});

router.post('/read-all', (req, res) => {
  req.db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(req.user.id);
  res.json({ ok: true });
});

router.post('/:notificationId/read', (req, res) => {
  req.db
    .prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?')
    .run(parse(id, req.params.notificationId), req.user.id);
  res.json({ ok: true });
});

export default router;
