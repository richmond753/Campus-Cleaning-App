const express = require('express');
const { queryOne } = require('../db/database');
const requireAuth = require('../middleware/requireAuth');
const asyncHandler = require('../middleware/asyncHandler');

const router = express.Router();

router.get('/booking/:id', requireAuth(), asyncHandler(async (req, res) => {
  const booking = await queryOne('SELECT * FROM bookings WHERE id = ?', [req.params.id]);
  if (!booking) return res.status(404).json({ error: 'Booking not found.' });

  const { role, id } = req.session.user;
  const allowed = role === 'admin' || booking.student_id === id || booking.cleaner_id === id;
  if (!allowed) return res.status(403).json({ error: 'You are not part of this conversation.' });

  const messages = await require('../db/database').query(`
    SELECT m.id, m.booking_id, m.sender_id, m.sender_role, m.message, m.created_at, u.full_name AS sender_name
    FROM messages m JOIN users u ON u.id = m.sender_id WHERE m.booking_id = ? ORDER BY m.created_at ASC`, [req.params.id]);
  res.json({ messages, booking });
}));

module.exports = router;
