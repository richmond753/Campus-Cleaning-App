const express = require('express');
const { queryOne } = require('../db/database');
const asyncHandler = require('../middleware/asyncHandler');

const router = express.Router();

router.get('/', asyncHandler(async (req, res) => {
  await queryOne('SELECT 1 AS ok');
  res.json({ ok: true, db: 'connected', timestamp: new Date().toISOString() });
}));

module.exports = router;
