const express = require('express');
const db = require('../db/database');
const requireAuth = require('../middleware/requireAuth');

const router = express.Router();

router.post('/', requireAuth(['student']), (req, res) => {
  const { booking_id, rating, comment } = req.body;
  const score = Number(rating);

  if (!booking_id || !score || score < 1 || score > 5) {
    return res.status(400).json({ error: 'A booking and a rating from 1 to 5 are required.' });
  }

  const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(booking_id);
  if (!booking || booking.student_id !== req.session.user.id) {
    return res.status(403).json({ error: 'This booking does not belong to you.' });
  }
  if (booking.status !== 'completed') {
    return res.status(409).json({ error: 'You can only rate jobs that are marked completed.' });
  }
  const existing = db.prepare('SELECT id FROM ratings WHERE booking_id = ?').get(booking_id);
  if (existing) {
    return res.status(409).json({ error: 'You already rated this job.' });
  }

  db.prepare(`
    INSERT INTO ratings (booking_id, student_id, cleaner_id, rating, comment)
    VALUES (?, ?, ?, ?, ?)
  `).run(booking_id, req.session.user.id, booking.cleaner_id, score, comment || null);

  res.json({ success: true, message: 'Thanks for the rating — it helps other students choose well.' });
});

router.get('/cleaner/:id', requireAuth(), (req, res) => {
  const rows = db.prepare(`
    SELECT r.rating, r.comment, r.created_at, u.full_name AS student_name
    FROM ratings r JOIN users u ON u.id = r.student_id
    WHERE r.cleaner_id = ?
    ORDER BY r.created_at DESC
  `).all(req.params.id);
  const { avg } = db.prepare('SELECT ROUND(AVG(rating), 1) AS avg FROM ratings WHERE cleaner_id = ?').get(req.params.id);
  res.json({ ratings: rows, average: avg || 0 });
});

module.exports = router;
