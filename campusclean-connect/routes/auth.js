const express = require('express');
const bcrypt = require('bcryptjs');
const { queryOne, execute } = require('../db/database');
const asyncHandler = require('../middleware/asyncHandler');
const { createOtp, verifyOtp, deliverOtp, isProd } = require('../services/otp');
const { notifyAdmins } = require('../services/notifications');

const router = express.Router();
const BOOKER_ROLES = ['student', 'lecturer'];

function toSafeUser(user) {
  return {
    id: user.id, username: user.username, role: user.role, full_name: user.full_name,
    email: user.email, phone: user.phone, room_number: user.room_number,
    department: user.department, office_location: user.office_location, avatar: user.avatar || null
  };
}

// Regenerates the session (anti session-fixation) and stores the user on it.
function establishSession(req, res, user) {
  const safeUser = toSafeUser(user);
  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: 'Could not start a session. Please try again.' });
    req.session.user = safeUser;
    req.session.save((saveErr) => {
      if (saveErr) return res.status(500).json({ error: 'Could not start a session. Please try again.' });
      res.json({ success: true, user: safeUser });
    });
  });
}

// Issues + "delivers" a signup OTP. In non-production we also return the code so
// it can be shown in-app (zero-cost delivery — no SMS/email bill).
async function issueSignupOtp(user) {
  const code = await createOtp(user.id, 'signup');
  await deliverOtp(user, code, 'signup');
  return isProd() ? undefined : code;
}

router.post('/register', asyncHandler(async (req, res) => {
  const { username, password, role, full_name, email, phone, room_number, department, office_location, bio, skills } = req.body;

  if (!username || !password || !role || !full_name) {
    return res.status(400).json({ error: 'Username, password, full name, and role are required.' });
  }
  if (!['student', 'lecturer', 'cleaner'].includes(role)) {
    return res.status(400).json({ error: 'Role must be student, lecturer, or cleaner.' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  }

  const existing = await queryOne('SELECT id FROM users WHERE username = ?', [username.trim()]);
  if (existing) return res.status(409).json({ error: 'That username is taken. Try another.' });

  const hashed = bcrypt.hashSync(password, 10);
  const result = await execute(
    `INSERT INTO users (username, password, role, full_name, email, phone, room_number, department, office_location, is_verified)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    [
      username.trim(), hashed, role, full_name.trim(), email || null, phone || null,
      role === 'student' ? (room_number || null) : null,
      role === 'lecturer' ? (department || null) : null,
      role === 'lecturer' ? (office_location || null) : null
    ]
  );

  if (role === 'cleaner') {
    await execute(`INSERT INTO cleaner_profiles (user_id, bio, skills, availability) VALUES (?, ?, ?, 'offline')`, [result.insertId, bio || '', skills || '']);
  }

  const newUser = await queryOne('SELECT id, username, email, phone FROM users WHERE id = ?', [result.insertId]);
  const devCode = await issueSignupOtp(newUser);

  await notifyAdmins(req.app.get('io'), {
    title: 'New account registered',
    body: `${full_name.trim()} signed up as a ${role}.`,
    type: 'info',
    link: '/admin-dashboard.html#users'
  });

  res.json({
    success: true,
    requiresVerification: true,
    userId: newUser.id,
    message: 'Account created. Enter the verification code to finish.',
    devCode
  });
}));

router.post('/verify-otp', asyncHandler(async (req, res) => {
  const { userId, code } = req.body;
  if (!userId || !code) return res.status(400).json({ error: 'User and verification code are required.' });

  const user = await queryOne('SELECT * FROM users WHERE id = ?', [userId]);
  if (!user) return res.status(404).json({ error: 'Account not found.' });
  if (user.is_verified) return establishSession(req, res, user); // already verified → just sign in

  const result = await verifyOtp(userId, code, 'signup');
  if (!result.ok) return res.status(400).json({ error: result.reason });

  await execute('UPDATE users SET is_verified = 1 WHERE id = ?', [userId]);
  establishSession(req, res, user);
}));

router.post('/resend-otp', asyncHandler(async (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'User is required.' });
  const user = await queryOne('SELECT id, username, email, phone, is_verified FROM users WHERE id = ?', [userId]);
  if (!user) return res.status(404).json({ error: 'Account not found.' });
  if (user.is_verified) return res.status(409).json({ error: 'This account is already verified.' });

  const devCode = await issueSignupOtp(user);
  res.json({ success: true, message: 'A new code has been sent.', devCode });
}));

router.post('/login', asyncHandler(async (req, res) => {
  const { username, password, role } = req.body;
  if (!username || !password || !role) {
    return res.status(400).json({ error: 'Username, password, and role are required.' });
  }

  const user = await queryOne('SELECT * FROM users WHERE username = ? AND role = ?', [username.trim(), role]);
  if (!user) return res.status(401).json({ error: 'No account found with that username for this role.' });
  if (user.status === 'suspended') return res.status(403).json({ error: 'This account has been suspended. Contact an administrator.' });
  if (!bcrypt.compareSync(password, user.password)) return res.status(401).json({ error: 'Incorrect password.' });

  // Unverified accounts can't sign in yet — issue a fresh code and route the
  // client to the verification step.
  if (!user.is_verified) {
    const devCode = await issueSignupOtp(user);
    return res.status(403).json({
      error: 'Please verify your account first. We just sent you a new code.',
      requiresVerification: true,
      userId: user.id,
      devCode
    });
  }

  establishSession(req, res, user);
}));

router.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) return res.status(500).json({ error: 'Could not sign out. Please try again.' });
    res.clearCookie('campusclean.sid');
    res.json({ success: true });
  });
});

router.get('/me', asyncHandler(async (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Not signed in.' });
  const row = await queryOne(
    `SELECT id, username, role, full_name, email, phone, room_number, department, office_location, avatar FROM users WHERE id = ?`,
    [req.session.user.id]
  );
  if (!row) return res.status(401).json({ error: 'Not signed in.' });
  req.session.user = { ...req.session.user, ...row, avatar: row.avatar || null };
  res.json({ user: req.session.user });
}));

module.exports = router;
module.exports.BOOKER_ROLES = BOOKER_ROLES;
