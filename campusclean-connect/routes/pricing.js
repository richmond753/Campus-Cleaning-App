const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const { computePrice, publicConfig } = require('../services/pricing');

const router = express.Router();

// Option lists + rates for the booking UI.
router.get('/config', asyncHandler(async (req, res) => {
  res.json({ config: publicConfig() });
}));

// Live estimate for the booking form (same engine the server uses to persist).
router.post('/quote', asyncHandler(async (req, res) => {
  const { service_type, room_size, bathrooms, addons, is_urgent } = req.body;
  const quote = computePrice({ service_type, room_size, bathrooms, addons, is_urgent });
  res.json({ quote });
}));

module.exports = router;
