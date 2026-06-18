const express = require('express');
const db = require('../db/database');
const requireAuth = require('../middleware/requireAuth');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const avatarStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, '../public/uploads/avatars'));
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `user_${req.session.user.id}_${Date.now()}${ext}`);
  }
});

const uploadAvatar = multer({
  storage: avatarStorage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.webp'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error('Only JPG, PNG, or WEBP images are allowed.'));
  }
});

const router = express.Router();

// Search / browse cleaners — used by the student "Find a cleaner" tab
router.get('/cleaners', requireAuth(), (req, res) => {
  const search = `%${(req.query.search || '').trim().toLowerCase()}%`;
  const rows = db.prepare(`
    SELECT
      u.id, u.full_name, u.email, u.phone, u.avatar,
      cp.bio, cp.skills, cp.availability,
      (SELECT ROUND(AVG(r.rating), 1) FROM ratings r WHERE r.cleaner_id = u.id) AS avg_rating,
      (SELECT COUNT(*) FROM ratings r WHERE r.cleaner_id = u.id) AS rating_count,
      (SELECT COUNT(*) FROM bookings b WHERE b.cleaner_id = u.id AND b.status = 'completed') AS jobs_done
    FROM users u
    JOIN cleaner_profiles cp ON cp.user_id = u.id
    WHERE u.role = 'cleaner' AND u.status = 'active' AND LOWER(u.full_name) LIKE ?
    ORDER BY COALESCE(avg_rating, 0) DESC, jobs_done DESC
  `).all(search);
  res.json({ cleaners: rows });
});

router.get('/cleaners/:id', requireAuth(), (req, res) => {
  const row = db.prepare(`
    SELECT u.id, u.full_name, u.email, u.phone,u.avatar, cp.bio, cp.skills, cp.availability,
      cp.current_lat, cp.current_lng, cp.location_updated_at
    FROM users u JOIN cleaner_profiles cp ON cp.user_id = u.id
    WHERE u.id = ? AND u.role = 'cleaner'
  `).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Cleaner not found.' });
  res.json({ cleaner: row });
});

// Cleaner toggles their own availability — broadcast live so student lists update instantly
router.patch('/me/avatar', requireAuth(), uploadAvatar.single('avatar'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file was uploaded.' });
    }

    // Delete old avatar file if one exists
    const existing = db.prepare('SELECT avatar FROM users WHERE id = ?').get(req.session.user.id);
    if (existing?.avatar) {
      const oldPath = path.join(__dirname, '../public/uploads/avatars', existing.avatar);
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }

    const filename = req.file.filename;
    db.prepare('UPDATE users SET avatar = ? WHERE id = ?').run(filename, req.session.user.id);

    res.json({ success: true, avatar: filename });
  } catch (err) {
    res.status(500).json({ error: 'Could not save the profile photo.' });
  }
});

// Quick stats for the cleaner dashboard header
router.get('/me/stats', requireAuth(['cleaner']), (req, res) => {
  const id = req.session.user.id;
  const stats = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM bookings WHERE cleaner_id = ? AND status = 'completed') AS completed,
      (SELECT COUNT(*) FROM bookings WHERE cleaner_id = ? AND status IN ('accepted','in_progress')) AS active,
      (SELECT ROUND(AVG(rating), 1) FROM ratings WHERE cleaner_id = ?) AS avg_rating
  `).get(id, id, id);
  res.json({ stats });
});

// Admin: list every user for the Manage Users table
router.get('/', requireAuth(['admin']), (req, res) => {
  const rows = db.prepare(`
    SELECT u.id, u.username, u.full_name, u.role, u.email, u.room_number, u.status, u.created_at,
      cp.availability
    FROM users u LEFT JOIN cleaner_profiles cp ON cp.user_id = u.id
    ORDER BY u.created_at DESC
  `).all();
  res.json({ users: rows });
});

router.patch('/:id/status', requireAuth(['admin']), (req, res) => {
  const { status } = req.body;
  if (!['active', 'suspended'].includes(status)) {
    return res.status(400).json({ error: 'Status must be active or suspended.' });
  }
  db.prepare('UPDATE users SET status = ? WHERE id = ?').run(status, req.params.id);
  res.json({ success: true });
});

module.exports = router;
