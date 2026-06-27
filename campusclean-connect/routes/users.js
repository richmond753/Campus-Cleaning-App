const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { query, queryOne, execute } = require('../db/database');
const requireAuth = require('../middleware/requireAuth');
const asyncHandler = require('../middleware/asyncHandler');
const { BOOKER_ROLES } = require('./auth');

const router = express.Router();

const uploadAvatar = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, path.join(__dirname, '../public/uploads/avatars')),
    filename: (req, file, cb) => cb(null, `user_${req.session.user.id}_${Date.now()}${path.extname(file.originalname).toLowerCase()}`)
  }),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    // Require BOTH a known image extension and a matching image MIME type, so a
    // non-image file can't slip through by renaming its extension (or vice versa).
    const allowedExt = ['.jpg', '.jpeg', '.png', '.webp'];
    const allowedMime = ['image/jpeg', 'image/png', 'image/webp'];
    const extOk = allowedExt.includes(path.extname(file.originalname).toLowerCase());
    const mimeOk = allowedMime.includes(file.mimetype);
    cb(null, extOk && mimeOk);
  }
});

router.get('/cleaners', requireAuth(), asyncHandler(async (req, res) => {
  const search = `%${(req.query.search || '').trim().toLowerCase()}%`;
  const skill = (req.query.skill || '').trim().toLowerCase();
  const availability = (req.query.availability || '').trim();

  let sql = `
    SELECT u.id, u.full_name, u.email, u.phone, u.avatar, cp.bio, cp.skills, cp.availability,
      (SELECT ROUND(AVG(r.rating), 1) FROM ratings r WHERE r.cleaner_id = u.id) AS avg_rating,
      (SELECT COUNT(*) FROM ratings r WHERE r.cleaner_id = u.id) AS rating_count,
      (SELECT COUNT(*) FROM bookings b WHERE b.cleaner_id = u.id AND b.status = 'completed') AS jobs_done
    FROM users u JOIN cleaner_profiles cp ON cp.user_id = u.id
    WHERE u.role = 'cleaner' AND u.status = 'active' AND LOWER(u.full_name) LIKE ?`;
  const params = [search];

  if (skill) { sql += ' AND LOWER(cp.skills) LIKE ?'; params.push(`%${skill}%`); }
  if (availability && ['available', 'busy', 'offline'].includes(availability)) { sql += ' AND cp.availability = ?'; params.push(availability); }

  sql += ` ORDER BY FIELD(cp.availability, 'available', 'busy', 'offline'), COALESCE(avg_rating, 0) DESC, jobs_done DESC`;
  res.json({ cleaners: await query(sql, params) });
}));

router.get('/cleaners/:id', requireAuth(), asyncHandler(async (req, res) => {
  const row = await queryOne(`
    SELECT u.id, u.full_name, u.email, u.phone, u.avatar, cp.bio, cp.skills, cp.availability,
      cp.current_lat, cp.current_lng, cp.location_updated_at
    FROM users u JOIN cleaner_profiles cp ON cp.user_id = u.id WHERE u.id = ? AND u.role = 'cleaner'`, [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Cleaner not found.' });

  // Live GPS is private. Only expose it to admins or to a requester who has an
  // active (accepted/in-progress) booking with this cleaner.
  const { role, id } = req.session.user;
  let canSeeLocation = role === 'admin';
  if (!canSeeLocation) {
    const active = await queryOne(
      `SELECT 1 FROM bookings
       WHERE cleaner_id = ? AND student_id = ? AND status IN ('accepted','in_progress') LIMIT 1`,
      [req.params.id, id]
    );
    canSeeLocation = Boolean(active);
  }
  if (!canSeeLocation) {
    row.current_lat = null;
    row.current_lng = null;
    row.location_updated_at = null;
  }
  res.json({ cleaner: row });
}));

router.patch('/cleaners/me/availability', requireAuth(['cleaner']), asyncHandler(async (req, res) => {
  const { availability } = req.body;
  if (!['available', 'busy', 'offline'].includes(availability)) return res.status(400).json({ error: 'Invalid availability.' });
  await execute('UPDATE cleaner_profiles SET availability = ? WHERE user_id = ?', [availability, req.session.user.id]);
  req.app.get('io').emit('cleaner:availability', { cleanerId: req.session.user.id, availability });
  res.json({ success: true, availability });
}));

router.patch('/cleaners/me/profile', requireAuth(['cleaner']), asyncHandler(async (req, res) => {
  const { bio, skills } = req.body;
  await execute('UPDATE cleaner_profiles SET bio = ?, skills = ? WHERE user_id = ?', [bio || '', skills || '', req.session.user.id]);
  res.json({ success: true });
}));

router.patch('/me/avatar', requireAuth(), uploadAvatar.single('avatar'), asyncHandler(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image file was uploaded.' });
  const existing = await queryOne('SELECT avatar FROM users WHERE id = ?', [req.session.user.id]);
  if (existing?.avatar) {
    const oldPath = path.join(__dirname, '../public/uploads/avatars', existing.avatar);
    if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
  }
  await execute('UPDATE users SET avatar = ? WHERE id = ?', [req.file.filename, req.session.user.id]);
  req.session.user.avatar = req.file.filename;
  res.json({ success: true, avatar: req.file.filename });
}));

router.patch('/me/profile', requireAuth(), asyncHandler(async (req, res) => {
  const { role, id } = req.session.user;
  const { full_name, email, phone, room_number, department, office_location, bio, skills } = req.body;

  if (BOOKER_ROLES.includes(role)) {
    await execute(
      `UPDATE users SET full_name = ?, email = ?, phone = ?, room_number = ?, department = ?, office_location = ? WHERE id = ?`,
      [(full_name || req.session.user.full_name).trim(), email || null, phone || null,
        role === 'student' ? (room_number || null) : null,
        role === 'lecturer' ? (department || null) : null,
        role === 'lecturer' ? (office_location || null) : null, id]
    );
  } else if (role === 'cleaner') {
    await execute('UPDATE users SET full_name = ?, email = ?, phone = ? WHERE id = ?', [(full_name || req.session.user.full_name).trim(), email || null, phone || null, id]);
    if (bio !== undefined || skills !== undefined) {
      await execute('UPDATE cleaner_profiles SET bio = COALESCE(?, bio), skills = COALESCE(?, skills) WHERE user_id = ?', [bio ?? null, skills ?? null, id]);
    }
  } else return res.status(403).json({ error: 'Profile updates are not available for this role.' });

  const row = await queryOne(`SELECT id, username, role, full_name, email, phone, room_number, department, office_location, avatar FROM users WHERE id = ?`, [id]);
  req.session.user = { ...req.session.user, ...row, avatar: row.avatar || null };
  res.json({ success: true, user: req.session.user });
}));

router.get('/me/stats', requireAuth(['cleaner']), asyncHandler(async (req, res) => {
  const uid = req.session.user.id;
  const stats = await queryOne(`
    SELECT
      (SELECT COUNT(*) FROM bookings WHERE cleaner_id = ? AND status = 'completed') AS completed,
      (SELECT COUNT(*) FROM bookings WHERE cleaner_id = ? AND status IN ('accepted','in_progress')) AS active,
      (SELECT ROUND(AVG(rating), 1) FROM ratings WHERE cleaner_id = ?) AS avg_rating`, [uid, uid, uid]);
  res.json({ stats });
}));

router.get('/', requireAuth(['admin']), asyncHandler(async (req, res) => {
  const rows = await query(`
    SELECT u.id, u.username, u.full_name, u.role, u.email, u.room_number, u.department, u.office_location, u.status, u.created_at, cp.availability
    FROM users u LEFT JOIN cleaner_profiles cp ON cp.user_id = u.id ORDER BY u.created_at DESC`);
  res.json({ users: rows });
}));

router.patch('/:id/status', requireAuth(['admin']), asyncHandler(async (req, res) => {
  const { status } = req.body;
  if (!['active', 'suspended'].includes(status)) return res.status(400).json({ error: 'Status must be active or suspended.' });
  await execute('UPDATE users SET status = ? WHERE id = ?', [status, req.params.id]);
  res.json({ success: true });
}));

module.exports = router;
