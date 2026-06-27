const express = require('express');
const { query, queryOne, execute } = require('../db/database');
const requireAuth = require('../middleware/requireAuth');
const asyncHandler = require('../middleware/asyncHandler');
const { createNotification } = require('../services/notifications');
const { computePrice } = require('../services/pricing');
const { BOOKER_ROLES } = require('./auth');

const router = express.Router();

const requesterSelect = `
  SELECT b.*,
    u.full_name AS requester_name,
    u.role AS requester_role,
    u.room_number AS requester_room,
    u.department AS requester_department,
    u.office_location AS requester_office,
    c.full_name AS cleaner_name,
    (SELECT COUNT(*) FROM ratings r WHERE r.booking_id = b.id) AS has_rating
`;

router.post('/', requireAuth(BOOKER_ROLES), asyncHandler(async (req, res) => {
  const { service_type, location, building, description, scheduled_time, requested_cleaner_id, is_urgent, room_size, bathrooms, addons } = req.body;
  if (!service_type || !location) {
    return res.status(400).json({ error: 'Service type and location are required.' });
  }

  // Price is computed server-side from the booking inputs — never trusted from
  // the client — so the stored amount and the 10% split can't be tampered with.
  const addonList = Array.isArray(addons) ? addons : [];
  const quote = computePrice({ service_type, room_size, bathrooms, addons: addonList, is_urgent });
  if (scheduled_time) {
    const when = new Date(scheduled_time.replace(' ', 'T'));
    if (!isNaN(when.getTime()) && when.getTime() < Date.now() - 60000) {
      return res.status(400).json({ error: 'Preferred time cannot be in the past.' });
    }
  }

  // If a specific cleaner was requested, ensure they actually exist, are a
  // cleaner, and are active — otherwise the booking could point at any user id.
  if (requested_cleaner_id) {
    const cleaner = await queryOne(
      `SELECT id FROM users WHERE id = ? AND role = 'cleaner' AND status = 'active'`,
      [requested_cleaner_id]
    );
    if (!cleaner) return res.status(400).json({ error: 'The requested cleaner is not available.' });
  }

  const result = await execute(
    `INSERT INTO bookings (student_id, requested_cleaner_id, service_type, location, building, description, scheduled_time, is_urgent, status, room_size, bathrooms, addons, amount, currency)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)`,
    [req.session.user.id, requested_cleaner_id || null, service_type, location.trim(), building || null, description || null, scheduled_time || null, is_urgent ? 1 : 0,
      room_size || null, Math.max(0, Number(bathrooms) || 0), addonList.length ? JSON.stringify(addonList) : null, quote.amount, quote.currency]
  );

  const booking = await queryOne('SELECT * FROM bookings WHERE id = ?', [result.insertId]);
  const io = req.app.get('io');
  if (requested_cleaner_id) {
    io.to(`user_${requested_cleaner_id}`).emit('booking:new', booking);
    await createNotification(io, requested_cleaner_id, {
      title: 'New booking request',
      body: `${req.session.user.full_name} requested ${booking.service_type} at ${booking.location}.`,
      type: 'booking',
      link: '/cleaner-dashboard.html#jobs'
    });
  } else {
    io.emit('booking:new', booking);
  }

  res.json({ success: true, booking });
}));

router.get('/', requireAuth(), asyncHandler(async (req, res) => {
  const { role, id } = req.session.user;
  let rows;

  if (BOOKER_ROLES.includes(role)) {
    rows = await query(`${requesterSelect} FROM bookings b LEFT JOIN users c ON c.id = b.cleaner_id JOIN users u ON u.id = b.student_id WHERE b.student_id = ? ORDER BY b.created_at DESC`, [id]);
  } else if (role === 'cleaner') {
    rows = await query(`
      SELECT b.*, u.full_name AS requester_name, u.role AS requester_role, u.room_number AS requester_room,
        u.department AS requester_department, u.office_location AS requester_office, u.full_name AS student_name
      FROM bookings b JOIN users u ON u.id = b.student_id
      WHERE b.cleaner_id = ? OR (b.cleaner_id IS NULL AND b.status = 'pending' AND (b.requested_cleaner_id IS NULL OR b.requested_cleaner_id = ?))
      ORDER BY b.is_urgent DESC, b.created_at DESC`, [id, id]);
  } else {
    rows = await query(`
      SELECT b.*, s.full_name AS requester_name, s.role AS requester_role, s.full_name AS student_name, c.full_name AS cleaner_name
      FROM bookings b JOIN users s ON s.id = b.student_id LEFT JOIN users c ON c.id = b.cleaner_id
      ORDER BY b.created_at DESC`);
  }

  res.json({ bookings: rows });
}));

router.get('/:id', requireAuth(), asyncHandler(async (req, res) => {
  const booking = await queryOne('SELECT * FROM bookings WHERE id = ?', [req.params.id]);
  if (!booking) return res.status(404).json({ error: 'Booking not found.' });

  const { role, id } = req.session.user;
  if (BOOKER_ROLES.includes(role) && booking.student_id !== id) return res.status(403).json({ error: 'This booking does not belong to you.' });
  if (role === 'cleaner' && booking.cleaner_id !== id && booking.status !== 'pending') return res.status(403).json({ error: 'This booking is not visible to you.' });
  res.json({ booking });
}));

router.patch('/:id/accept', requireAuth(['cleaner']), asyncHandler(async (req, res) => {
  const booking = await queryOne('SELECT * FROM bookings WHERE id = ?', [req.params.id]);
  if (!booking) return res.status(404).json({ error: 'Booking not found.' });
  if (booking.status !== 'pending') return res.status(409).json({ error: 'This job has already been taken.' });
  if (booking.requested_cleaner_id && booking.requested_cleaner_id !== req.session.user.id) {
    return res.status(403).json({ error: 'This job was requested for a different cleaner.' });
  }

  await execute(`UPDATE bookings SET cleaner_id = ?, status = 'accepted', updated_at = NOW() WHERE id = ?`, [req.session.user.id, booking.id]);
  await execute(`UPDATE cleaner_profiles SET availability = 'busy' WHERE user_id = ?`, [req.session.user.id]);

  const updated = await queryOne('SELECT * FROM bookings WHERE id = ?', [booking.id]);
  const io = req.app.get('io');
  io.to(`user_${booking.student_id}`).emit('booking:update', updated);
  io.emit('cleaner:availability', { cleanerId: req.session.user.id, availability: 'busy' });
  await createNotification(io, booking.student_id, {
    title: 'Booking accepted',
    body: `${req.session.user.full_name} accepted your ${booking.service_type} request.`,
    type: 'booking',
    link: '/dashboard.html#bookings'
  });
  res.json({ success: true, booking: updated });
}));

router.patch('/:id/status', requireAuth(), asyncHandler(async (req, res) => {
  const { status, cancel_reason } = req.body;
  const allowed = ['in_progress', 'completed', 'cancelled', 'declined'];
  if (!allowed.includes(status)) return res.status(400).json({ error: 'Invalid status value.' });

  const booking = await queryOne('SELECT * FROM bookings WHERE id = ?', [req.params.id]);
  if (!booking) return res.status(404).json({ error: 'Booking not found.' });

  const { role, id } = req.session.user;
  const isOwner = (BOOKER_ROLES.includes(role) && booking.student_id === id) || (role === 'cleaner' && booking.cleaner_id === id) || role === 'admin';
  if (!isOwner) return res.status(403).json({ error: 'You cannot update this booking.' });

  if (BOOKER_ROLES.includes(role)) {
    if (status !== 'cancelled') return res.status(403).json({ error: 'You can only cancel your booking.' });
    if (!['accepted', 'in_progress'].includes(booking.status)) {
      return res.status(409).json({ error: 'Only accepted or in-progress bookings can be cancelled. Withdraw pending requests instead.' });
    }
  }

  if (role === 'admin' && status === 'cancelled' && cancel_reason?.trim()) {
    const note = `[Admin cancelled: ${cancel_reason.trim()}]`;
    const desc = booking.description ? `${booking.description}\n${note}` : note;
    await execute(`UPDATE bookings SET status = ?, description = ?, updated_at = NOW() WHERE id = ?`, [status, desc, booking.id]);
  } else {
    await execute(`UPDATE bookings SET status = ?, updated_at = NOW() WHERE id = ?`, [status, booking.id]);
  }

  const io = req.app.get('io');
  const cleanerId = booking.cleaner_id;
  if (cleanerId && ['completed', 'declined', 'cancelled'].includes(status)) {
    const active = await queryOne(
      `SELECT COUNT(*) AS c FROM bookings WHERE cleaner_id = ? AND status IN ('accepted', 'in_progress')`,
      [cleanerId]
    );
    if (active.c === 0) {
      await execute(`UPDATE cleaner_profiles SET availability = 'available' WHERE user_id = ?`, [cleanerId]);
      io.emit('cleaner:availability', { cleanerId, availability: 'available' });
    }
  }

  const updated = await queryOne('SELECT * FROM bookings WHERE id = ?', [booking.id]);
  const recipients = new Set();
  if (role === 'cleaner') recipients.add(booking.student_id);
  else if (BOOKER_ROLES.includes(role)) {
    if (booking.cleaner_id) recipients.add(booking.cleaner_id);
  } else {
    if (booking.student_id) recipients.add(booking.student_id);
    if (booking.cleaner_id) recipients.add(booking.cleaner_id);
  }

  const STATUS_TEXT = { in_progress: 'in progress', completed: 'completed', cancelled: 'cancelled', declined: 'declined' };
  for (const uid of recipients) {
    if (!uid) continue;
    io.to(`user_${uid}`).emit('booking:update', updated);
    await createNotification(io, uid, {
      title: `Booking ${STATUS_TEXT[status] || status}`,
      body: `Your ${booking.service_type} booking at ${booking.location} is now ${STATUS_TEXT[status] || status}.`,
      type: 'booking',
      link: uid === booking.cleaner_id ? '/cleaner-dashboard.html#jobs' : '/dashboard.html#bookings'
    });
  }
  res.json({ success: true, booking: updated });
}));

router.delete('/:id', requireAuth(BOOKER_ROLES), asyncHandler(async (req, res) => {
  const booking = await queryOne('SELECT * FROM bookings WHERE id = ?', [req.params.id]);
  if (!booking) return res.status(404).json({ error: 'Booking not found.' });
  if (booking.student_id !== req.session.user.id) return res.status(403).json({ error: 'This booking does not belong to you.' });
  if (booking.status !== 'pending') return res.status(409).json({ error: 'Only pending requests can be withdrawn.' });

  await execute(`UPDATE bookings SET status = 'cancelled', updated_at = NOW() WHERE id = ?`, [booking.id]);
  res.json({ success: true });
}));

module.exports = router;
