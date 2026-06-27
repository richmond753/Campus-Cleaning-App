const crypto = require('crypto');
const express = require('express');
const { query, queryOne, execute } = require('../db/database');
const requireAuth = require('../middleware/requireAuth');
const asyncHandler = require('../middleware/asyncHandler');
const paystack = require('../services/payments/paystack');
const { createNotification } = require('../services/notifications');
const { BOOKER_ROLES } = require('./auth');

const router = express.Router();

const COMMISSION_PERCENT = Math.min(Math.max(Number(process.env.PLATFORM_COMMISSION_PERCENT || 10), 0), 100);

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function splitFor(amount) {
  const platform_fee = round2((Number(amount) * COMMISSION_PERCENT) / 100);
  const cleaner_earnings = round2(Number(amount) - platform_fee);
  return { platform_fee, cleaner_earnings };
}

function makeReference(bookingId) {
  return `CC-${bookingId}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
}

// Lists the payment methods the server can actually process right now.
function availableMethods() {
  const methods = [
    { id: 'cash', label: 'Cash on completion', channels: ['cash'], note: 'Pay your cleaner directly; they confirm receipt.' }
  ];
  if (paystack.isConfigured()) {
    methods.unshift(
      { id: 'momo', label: 'Mobile Money (MTN, Telecel, AirtelTigo)', channels: ['mobile_money'], provider: 'paystack' },
      { id: 'card', label: 'Card', channels: ['card'], provider: 'paystack' },
      { id: 'bank', label: 'Bank transfer', channels: ['bank', 'bank_transfer'], provider: 'paystack' }
    );
  }
  return methods;
}

// Records the split, marks everything paid, and notifies the parties.
async function finalizePayment(io, payment, channel) {
  const { platform_fee, cleaner_earnings } = splitFor(payment.amount);
  await execute(
    `UPDATE payments SET status = 'success', channel = ?, platform_fee = ?, cleaner_earnings = ?, paid_at = NOW() WHERE id = ?`,
    [channel || payment.channel || null, platform_fee, cleaner_earnings, payment.id]
  );
  await execute(`UPDATE bookings SET payment_status = 'paid' WHERE id = ?`, [payment.booking_id]);

  const cur = payment.currency;
  if (payment.cleaner_id) {
    await createNotification(io, payment.cleaner_id, {
      title: 'Payment received',
      body: `You earned ${cur} ${cleaner_earnings.toFixed(2)} for booking BK-${String(payment.booking_id).padStart(4, '0')} (after ${COMMISSION_PERCENT}% platform fee).`,
      type: 'info',
      link: '/cleaner-dashboard.html#earnings'
    });
  }
  await createNotification(io, payment.payer_id, {
    title: 'Payment successful',
    body: `Your payment of ${cur} ${Number(payment.amount).toFixed(2)} for BK-${String(payment.booking_id).padStart(4, '0')} went through. Thank you!`,
    type: 'info',
    link: '/dashboard.html#bookings'
  });
  return { platform_fee, cleaner_earnings };
}

// What payment methods exist + the platform commission (for the UI).
router.get('/methods', requireAuth(), asyncHandler(async (req, res) => {
  res.json({ methods: availableMethods(), commissionPercent: COMMISSION_PERCENT });
}));

// Booker starts a payment for one of their bookings.
router.post('/init', requireAuth(BOOKER_ROLES), asyncHandler(async (req, res) => {
  const { bookingId, method } = req.body;
  const booking = await queryOne('SELECT * FROM bookings WHERE id = ?', [bookingId]);
  if (!booking) return res.status(404).json({ error: 'Booking not found.' });
  if (booking.student_id !== req.session.user.id) return res.status(403).json({ error: 'This booking does not belong to you.' });
  if (Number(booking.amount) <= 0) return res.status(400).json({ error: 'This booking has no payable amount.' });
  if (booking.payment_status === 'paid') return res.status(409).json({ error: 'This booking is already paid.' });
  if (!booking.cleaner_id) return res.status(409).json({ error: 'You can pay once a cleaner has accepted the job.' });

  const chosen = availableMethods().find((m) => m.id === method);
  if (!chosen) return res.status(400).json({ error: 'That payment method is not available.' });

  const reference = makeReference(booking.id);
  await execute(
    `INSERT INTO payments (booking_id, payer_id, cleaner_id, provider, channel, reference, amount, currency, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
    [booking.id, req.session.user.id, booking.cleaner_id, chosen.provider || 'cash', chosen.channels[0], reference, booking.amount, booking.currency]
  );
  await execute(`UPDATE bookings SET payment_status = 'pending' WHERE id = ?`, [booking.id]);

  if (chosen.provider === 'paystack') {
    const email = req.session.user.email || `user${req.session.user.id}@campusclean.local`;
    // Initialize server-side so we always have a verifiable reference; the
    // client opens the inline popup with the same reference + public key.
    await paystack.initializeTransaction({
      email,
      amount: booking.amount,
      currency: booking.currency,
      reference,
      channels: chosen.channels,
      metadata: { booking_id: booking.id, payer_id: req.session.user.id }
    });
    return res.json({
      provider: 'paystack',
      publicKey: paystack.publicKey(),
      email,
      reference,
      amount: booking.amount,
      currency: booking.currency,
      channels: chosen.channels
    });
  }

  // Cash: nothing to charge online — the cleaner confirms receipt later.
  res.json({ provider: 'cash', reference, amount: booking.amount, currency: booking.currency, message: 'Pay your cleaner in cash. They will confirm receipt to close the payment.' });
}));

// Booker's client calls this after the Paystack popup reports success.
router.post('/verify', requireAuth(), asyncHandler(async (req, res) => {
  const { reference } = req.body;
  const payment = await queryOne('SELECT * FROM payments WHERE reference = ?', [reference]);
  if (!payment) return res.status(404).json({ error: 'Payment not found.' });
  if (payment.payer_id !== req.session.user.id && req.session.user.role !== 'admin') {
    return res.status(403).json({ error: 'This payment is not yours.' });
  }
  if (payment.status === 'success') return res.json({ success: true, alreadyVerified: true });
  if (payment.provider !== 'paystack') return res.status(400).json({ error: 'This payment is not a card/MoMo payment.' });

  const data = await paystack.verifyTransaction(reference);
  if (!data || data.status !== 'success') {
    await execute(`UPDATE payments SET status = 'failed' WHERE id = ?`, [payment.id]);
    return res.status(402).json({ error: 'Payment was not successful.' });
  }
  if (Number(data.amount) < paystack.toSubunit(payment.amount)) {
    return res.status(400).json({ error: 'Paid amount does not match the booking.' });
  }

  const split = await finalizePayment(req.app.get('io'), payment, data.channel);
  res.json({ success: true, ...split });
}));

// The assigned cleaner (or an admin) confirms a cash payment was received.
router.post('/confirm-cash', requireAuth(['cleaner', 'admin']), asyncHandler(async (req, res) => {
  const { reference } = req.body;
  const payment = await queryOne('SELECT * FROM payments WHERE reference = ?', [reference]);
  if (!payment) return res.status(404).json({ error: 'Payment not found.' });
  if (payment.provider !== 'cash') return res.status(400).json({ error: 'This is not a cash payment.' });
  if (payment.status === 'success') return res.json({ success: true, alreadyVerified: true });
  if (req.session.user.role !== 'admin' && payment.cleaner_id !== req.session.user.id) {
    return res.status(403).json({ error: 'Only the assigned cleaner can confirm this cash payment.' });
  }

  const split = await finalizePayment(req.app.get('io'), payment, 'cash');
  res.json({ success: true, ...split });
}));

// Role-aware earnings / revenue summary.
router.get('/summary', requireAuth(), asyncHandler(async (req, res) => {
  const { role, id } = req.session.user;

  if (role === 'cleaner') {
    const totals = await queryOne(
      `SELECT
         COALESCE(SUM(CASE WHEN status='success' THEN cleaner_earnings END), 0) AS total_earned,
         COALESCE(SUM(CASE WHEN status='success' THEN amount END), 0) AS gross,
         COUNT(CASE WHEN status='success' THEN 1 END) AS paid_count,
         COUNT(CASE WHEN status='pending' AND provider='cash' THEN 1 END) AS cash_pending
       FROM payments WHERE cleaner_id = ?`, [id]);
    const recent = await query(
      `SELECT p.*, b.service_type, b.location FROM payments p JOIN bookings b ON b.id = p.booking_id
       WHERE p.cleaner_id = ? ORDER BY p.created_at DESC LIMIT 20`, [id]);
    return res.json({ role, totals, recent });
  }

  if (role === 'admin') {
    const totals = await queryOne(
      `SELECT
         COALESCE(SUM(CASE WHEN status='success' THEN platform_fee END), 0) AS platform_revenue,
         COALESCE(SUM(CASE WHEN status='success' THEN amount END), 0) AS gross_volume,
         COALESCE(SUM(CASE WHEN status='success' THEN cleaner_earnings END), 0) AS paid_to_cleaners,
         COUNT(CASE WHEN status='success' THEN 1 END) AS paid_count
       FROM payments`);
    const recent = await query(
      `SELECT p.*, b.service_type, u.full_name AS payer_name, c.full_name AS cleaner_name
       FROM payments p JOIN bookings b ON b.id = p.booking_id
       JOIN users u ON u.id = p.payer_id LEFT JOIN users c ON c.id = p.cleaner_id
       ORDER BY p.created_at DESC LIMIT 30`);
    return res.json({ role, totals, recent });
  }

  // Booker: their own payments.
  const recent = await query(
    `SELECT p.*, b.service_type, b.location FROM payments p JOIN bookings b ON b.id = p.booking_id
     WHERE p.payer_id = ? ORDER BY p.created_at DESC LIMIT 20`, [id]);
  res.json({ role, recent });
}));

module.exports = router;
