const express = require('express');
const { query, queryOne, execute } = require('../db/database');
const requireAuth = require('../middleware/requireAuth');
const asyncHandler = require('../middleware/asyncHandler');

const router = express.Router();

// Most recent notifications for the signed-in user, plus an unread count.
router.get('/', requireAuth(), asyncHandler(async (req, res) => {
  const uid = req.session.user.id;
  const items = await query(
    `SELECT id, title, body, type, link, is_read, created_at
     FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`,
    [uid]
  );
  const unread = await queryOne(
    `SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND is_read = 0`,
    [uid]
  );
  res.json({ notifications: items, unread: unread.c });
}));

router.patch('/:id/read', requireAuth(), asyncHandler(async (req, res) => {
  await execute('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?', [req.params.id, req.session.user.id]);
  res.json({ success: true });
}));

router.patch('/read-all', requireAuth(), asyncHandler(async (req, res) => {
  await execute('UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0', [req.session.user.id]);
  res.json({ success: true });
}));

module.exports = router;
