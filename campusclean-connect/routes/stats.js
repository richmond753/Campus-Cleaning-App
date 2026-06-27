const express = require('express');
const { queryOne } = require('../db/database');
const asyncHandler = require('../middleware/asyncHandler');

const router = express.Router();

router.get('/public', asyncHandler(async (req, res) => {
  const stats = await queryOne(`
    SELECT
      (SELECT COUNT(*) FROM users WHERE role = 'cleaner' AND status = 'active') AS cleaners,
      (SELECT COUNT(*) FROM users WHERE role = 'student' AND status = 'active') AS students,
      (SELECT COUNT(*) FROM users WHERE role = 'lecturer' AND status = 'active') AS lecturers,
      (SELECT COUNT(*) FROM bookings WHERE status = 'completed') AS completed_bookings,
      (SELECT COUNT(*) FROM cleaner_profiles WHERE availability = 'available') AS available_cleaners,
      (SELECT COUNT(*) FROM bookings WHERE status IN ('pending','accepted','in_progress')) AS active_bookings`);
  res.json({ stats });
}));

module.exports = router;
