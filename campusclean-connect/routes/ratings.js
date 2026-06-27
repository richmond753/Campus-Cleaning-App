const express = require('express');
const { query, queryOne, execute } = require('../db/database');
const requireAuth = require('../middleware/requireAuth');
const asyncHandler = require('../middleware/asyncHandler');
const { BOOKER_ROLES } = require('./auth');

const router = express.Router();

router.post('/', requireAuth(BOOKER_ROLES), asyncHandler(async (req, res) => {
  const { booking_id, rating, comment } = req.body;
  const score = Number(rating);
  if (!booking_id || !score || score < 1 || score > 5) return res.status(400).json({ error: 'A booking and a rating from 1 to 5 are required.' });

  const booking = await queryOne('SELECT * FROM bookings WHERE id = ?', [booking_id]);
  if (!booking || booking.student_id !== req.session.user.id) return res.status(403).json({ error: 'This booking does not belong to you.' });
  if (booking.status !== 'completed') return res.status(409).json({ error: 'You can only rate completed jobs.' });
  const existing = await queryOne('SELECT id FROM ratings WHERE booking_id = ?', [booking_id]);
  if (existing) return res.status(409).json({ error: 'You already rated this job.' });

  await execute(`INSERT INTO ratings (booking_id, student_id, cleaner_id, rating, comment) VALUES (?, ?, ?, ?, ?)`,
    [booking_id, req.session.user.id, booking.cleaner_id, score, comment || null]);
  res.json({ success: true, message: 'Thanks for the rating — it helps others choose well.' });
}));

router.get('/cleaner/:id', requireAuth(), asyncHandler(async (req, res) => {
  const ratings = await query(`
    SELECT r.rating, r.comment, r.created_at, u.full_name AS requester_name
    FROM ratings r JOIN users u ON u.id = r.student_id WHERE r.cleaner_id = ? ORDER BY r.created_at DESC`, [req.params.id]);
  const avgRow = await queryOne('SELECT ROUND(AVG(rating), 1) AS avg FROM ratings WHERE cleaner_id = ?', [req.params.id]);
  res.json({ ratings, average: avgRow?.avg || 0 });
}));

module.exports = router;
