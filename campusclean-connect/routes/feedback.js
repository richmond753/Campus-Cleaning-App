const express = require('express');
const { query, execute } = require('../db/database');
const requireAuth = require('../middleware/requireAuth');
const asyncHandler = require('../middleware/asyncHandler');
const { notifyAdmins } = require('../services/notifications');

const router = express.Router();

router.post('/', asyncHandler(async (req, res) => {
  const { name, email, subject, message } = req.body;
  if (!name || !message) return res.status(400).json({ error: 'Name and message are required.' });
  const userId = req.session.user ? req.session.user.id : null;
  await execute(`INSERT INTO feedback (user_id, name, email, subject, message) VALUES (?, ?, ?, ?, ?)`,
    [userId, name.trim(), email || null, subject || null, message.trim()]);

  await notifyAdmins(req.app.get('io'), {
    title: 'New feedback received',
    body: `${name.trim()}: ${(subject || message).trim().slice(0, 100)}`,
    type: 'info',
    link: '/admin-dashboard.html#feedback'
  });

  res.json({ success: true, message: 'Thanks — your message has been sent to the team.' });
}));

router.get('/', requireAuth(['admin']), asyncHandler(async (req, res) => {
  res.json({ feedback: await query('SELECT * FROM feedback ORDER BY created_at DESC') });
}));

router.patch('/:id/status', requireAuth(['admin']), asyncHandler(async (req, res) => {
  const { status } = req.body;
  if (!['new', 'read', 'resolved'].includes(status)) return res.status(400).json({ error: 'Invalid status.' });
  await execute('UPDATE feedback SET status = ? WHERE id = ?', [status, req.params.id]);
  res.json({ success: true });
}));

module.exports = router;
