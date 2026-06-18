const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db/database');

const router = express.Router();

// Students and cleaners can self-register. Admin accounts are seeded only.
router.post('/register', (req, res) => {
  const { username, password, role, full_name, email, phone, room_number, bio, skills } = req.body;

  if (!username || !password || !role || !full_name) {
    return res.status(400).json({ error: 'Username, password, full name, and role are required.' });
  }
  if (!['student', 'cleaner'].includes(role)) {
    return res.status(400).json({ error: 'Role must be student or cleaner.' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  }

  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username.trim());
  if (existing) {
    return res.status(409).json({ error: 'That username is taken. Try another.' });
  }

  const hashed = bcrypt.hashSync(password, 10);
  const result = db.prepare(`
    INSERT INTO users (username, password, role, full_name, email, phone, room_number)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(username.trim(), hashed, role, full_name.trim(), email || null, phone || null, room_number || null);

  if (role === 'cleaner') {
    db.prepare(`
      INSERT INTO cleaner_profiles (user_id, bio, skills, availability)
      VALUES (?, ?, ?, 'offline')
    `).run(result.lastInsertRowid, bio || '', skills || '');
  }

  res.json({ success: true, message: 'Account created. You can now sign in.' });
});

router.post('/login', (req, res) => {
  const { username, password, role } = req.body;
  if (!username || !password || !role) {
    return res.status(400).json({ error: 'Username, password, and role are required.' });
  }

  const user = db.prepare('SELECT * FROM users WHERE username = ? AND role = ?').get(username.trim(), role);
  if (!user) {
    return res.status(401).json({ error: 'No account found with that username for this role.' });
  }
  if (user.status === 'suspended') {
    return res.status(403).json({ error: 'This account has been suspended. Contact an administrator.' });
  }
  const valid = bcrypt.compareSync(password, user.password);
  if (!valid) {
    return res.status(401).json({ error: 'Incorrect password.' });
  }

 const safeUser = {
  id: user.id,
  username: user.username,
  role: user.role,
  full_name: user.full_name,
  email: user.email,
  room_number: user.room_number,
  avatar: user.avatar || null
};
req.session.user = safeUser;
  res.json({ success: true, user: safeUser });
});

router.get('/me', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Not signed in.' });
  res.json({ user: req.session.user });
});

module.exports = router;
