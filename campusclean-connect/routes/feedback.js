const express = require('express');
const db = require('../db/database');
const requireAuth = require('../middleware/requireAuth');

const router = express.Router();

// Open to anyone — signed in or not — so the public Contact Us page works pre-login
router.post('/', (req, res) => {
  const { name, email, subject, message } = req.body;
  if (!name || !message) {
    return res.status(400).json({ error: 'Name and message are required.' });
  }
  const userId = req.session.user ? req.session.user.id : null;
  db.prepare(`
    INSERT INTO feedback (user_id, name, email, subject, message)
    VALUES (?, ?, ?, ?, ?)
  `).run(userId, name.trim(), email || null, subject || null, message.trim());

  res.json({ success: true, message: 'Thanks — your message has been sent to the team.' });
});

router.get('/', requireAuth(['admin']), (req, res) => {
  const rows = db.prepare('SELECT * FROM feedback ORDER BY created_at DESC').all();
  res.json({ feedback: rows });
});

router.patch('/:id/status', requireAuth(['admin']), (req, res) => {
  const { status } = req.body;
  if (!['new', 'read', 'resolved'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status.' });
  }
  db.prepare('UPDATE feedback SET status = ? WHERE id = ?').run(status, req.params.id);
  res.json({ success: true });
});

module.exports = router;
