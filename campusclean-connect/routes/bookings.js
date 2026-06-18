const express = require('express');
const db = require('../db/database');
const requireAuth = require('../middleware/requireAuth');

const router = express.Router();

// Student requests a clean — either open to any available cleaner, or aimed at one specific cleaner
router.post('/', requireAuth(['student']), (req, res) => {
  const { service_type, location, description, scheduled_time, requested_cleaner_id } = req.body;
  if (!service_type || !location) {
    return res.status(400).json({ error: 'Service type and room/location are required.' });
  }

  const result = db.prepare(`
    INSERT INTO bookings (student_id, requested_cleaner_id, service_type, location, description, scheduled_time, status)
    VALUES (?, ?, ?, ?, ?, ?, 'pending')
  `).run(req.session.user.id, requested_cleaner_id || null, service_type, location, description || null, scheduled_time || null);

  const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(result.lastInsertRowid);

  const io = req.app.get('io');
  if (requested_cleaner_id) {
    io.to(`user_${requested_cleaner_id}`).emit('booking:new', booking);
  } else {
    io.emit('booking:new', booking); // let every online cleaner know a new open job exists
  }

  res.json({ success: true, booking });
});

// List bookings — shape depends on who's asking
router.get('/', requireAuth(), (req, res) => {
  const { role, id } = req.session.user;
  let rows;

  if (role === 'student') {
    rows = db.prepare(`
      SELECT b.*, u.full_name AS cleaner_name,
        (SELECT COUNT(*) FROM ratings r WHERE r.booking_id = b.id) AS has_rating
      FROM bookings b LEFT JOIN users u ON u.id = b.cleaner_id
      WHERE b.student_id = ?
      ORDER BY b.created_at DESC
    `).all(id);
  } else if (role === 'cleaner') {
    rows = db.prepare(`
      SELECT b.*, u.full_name AS student_name, u.room_number AS student_room
      FROM bookings b JOIN users u ON u.id = b.student_id
      WHERE b.cleaner_id = ?
         OR (b.cleaner_id IS NULL AND b.status = 'pending' AND (b.requested_cleaner_id IS NULL OR b.requested_cleaner_id = ?))
      ORDER BY b.created_at DESC
    `).all(id, id);
  } else {
    rows = db.prepare(`
      SELECT b.*, s.full_name AS student_name, c.full_name AS cleaner_name
      FROM bookings b
      JOIN users s ON s.id = b.student_id
      LEFT JOIN users c ON c.id = b.cleaner_id
      ORDER BY b.created_at DESC
    `).all();
  }
  res.json({ bookings: rows });
});

router.get('/:id', requireAuth(), (req, res) => {
  const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(req.params.id);
  if (!booking) return res.status(404).json({ error: 'Booking not found.' });

  const { role, id } = req.session.user;
  if (role === 'student' && booking.student_id !== id) {
    return res.status(403).json({ error: 'This booking does not belong to you.' });
  }
  if (role === 'cleaner' && booking.cleaner_id !== id && booking.status !== 'pending') {
    return res.status(403).json({ error: 'This booking is not visible to you.' });
  }
  res.json({ booking });
});

// Cleaner accepts an open job
router.patch('/:id/accept', requireAuth(['cleaner']), (req, res) => {
  const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(req.params.id);
  if (!booking) return res.status(404).json({ error: 'Booking not found.' });
  if (booking.status !== 'pending') {
    return res.status(409).json({ error: 'This job has already been taken.' });
  }
  if (booking.requested_cleaner_id && booking.requested_cleaner_id !== req.session.user.id) {
    return res.status(403).json({ error: 'This job was requested for a different cleaner.' });
  }

  db.prepare(`UPDATE bookings SET cleaner_id = ?, status = 'accepted', updated_at = datetime('now') WHERE id = ?`)
    .run(req.session.user.id, booking.id);

  const updated = db.prepare('SELECT * FROM bookings WHERE id = ?').get(booking.id);
  req.app.get('io').to(`user_${booking.student_id}`).emit('booking:update', updated);
  res.json({ success: true, booking: updated });
});

// Move a job through its lifecycle, or cancel/decline it
router.patch('/:id/status', requireAuth(), (req, res) => {
  const { status } = req.body;
  const allowed = ['in_progress', 'completed', 'cancelled', 'declined'];
  if (!allowed.includes(status)) {
    return res.status(400).json({ error: 'Invalid status value.' });
  }

  const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(req.params.id);
  if (!booking) return res.status(404).json({ error: 'Booking not found.' });

  const { role, id } = req.session.user;
  const isOwner =
    (role === 'student' && booking.student_id === id) ||
    (role === 'cleaner' && booking.cleaner_id === id) ||
    role === 'admin';
  if (!isOwner) return res.status(403).json({ error: 'You cannot update this booking.' });

  db.prepare(`UPDATE bookings SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(status, booking.id);
  const updated = db.prepare('SELECT * FROM bookings WHERE id = ?').get(booking.id);

  const io = req.app.get('io');
  const notifyId = role === 'cleaner' ? booking.student_id : booking.cleaner_id;
  if (notifyId) io.to(`user_${notifyId}`).emit('booking:update', updated);

  res.json({ success: true, booking: updated });
});

// Student withdraws a request that nobody has accepted yet
router.delete('/:id', requireAuth(['student']), (req, res) => {
  const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(req.params.id);
  if (!booking) return res.status(404).json({ error: 'Booking not found.' });
  if (booking.student_id !== req.session.user.id) {
    return res.status(403).json({ error: 'This booking does not belong to you.' });
  }
  if (booking.status !== 'pending') {
    return res.status(409).json({ error: 'Only requests that have not been accepted yet can be withdrawn.' });
  }
  db.prepare(`UPDATE bookings SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?`).run(booking.id);
  res.json({ success: true });
});

module.exports = router;
