/* Pricing engine for CampusClean.
   Kept deliberately affordable for a campus setting and transparent: the price
   is built from room size + bathrooms + add-ons, scaled by the service type,
   with an optional urgent (express) premium and a minimum charge. Currency is
   GHS. Tweak the CONFIG below to adjust rates in one place. */

const CURRENCY = process.env.CURRENCY || 'GHS';

const CONFIG = {
  currency: CURRENCY,
  minimumCharge: 15,
  urgentMultiplier: 1.25, // express premium for urgent jobs

  // Base price by space size (GHS).
  roomSizes: [
    { id: 'single_room', label: 'Single dorm room', base: 15 },
    { id: 'shared_room', label: 'Shared room', base: 20 },
    { id: 'studio', label: 'Studio / bedsitter', base: 25 },
    { id: '1br', label: '1 bedroom', base: 32 },
    { id: '2br', label: '2 bedrooms', base: 48 },
    { id: '3br', label: '3 bedrooms', base: 65 },
    { id: 'office_small', label: 'Small office', base: 28 },
    { id: 'office_large', label: 'Large office / lab', base: 45 },
    { id: 'common_area', label: 'Common area / hall', base: 40 }
  ],

  perBathroom: 8,

  // Multiplier applied to the size base, by service type.
  serviceMultipliers: {
    'General cleaning': 1.0,
    'Deep cleaning': 1.6,
    'Move-out cleaning': 2.0,
    'Window cleaning': 1.2,
    'Laundry': 0.9,
    'Dishes': 0.6,
    'Trash removal': 0.5,
    'Other': 1.0
  },

  // Optional flat-fee add-ons (GHS).
  addons: [
    { id: 'inside_fridge', label: 'Inside fridge', price: 10 },
    { id: 'inside_windows', label: 'Inside windows', price: 8 },
    { id: 'laundry_fold', label: 'Laundry & fold', price: 12 },
    { id: 'dishes', label: 'Dishes', price: 6 },
    { id: 'ironing', label: 'Ironing', price: 8 },
    { id: 'balcony', label: 'Balcony / patio', price: 6 }
  ]
};

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// Computes a price and an itemised breakdown from booking inputs. Unknown
// values fall back to sensible defaults so a bare booking still gets a price.
function computePrice({ service_type, room_size, bathrooms = 0, addons = [], is_urgent = false } = {}) {
  const breakdown = [];

  const size = CONFIG.roomSizes.find((s) => s.id === room_size) || CONFIG.roomSizes[0];
  const multiplier = CONFIG.serviceMultipliers[service_type] != null ? CONFIG.serviceMultipliers[service_type] : 1.0;

  const baseForService = round2(size.base * multiplier);
  breakdown.push({ label: `${size.label} — ${service_type || 'General cleaning'}`, amount: baseForService });

  const baths = Math.max(0, Math.min(Number(bathrooms) || 0, 10));
  if (baths > 0) {
    const bathCost = round2(baths * CONFIG.perBathroom);
    breakdown.push({ label: `${baths} bathroom${baths > 1 ? 's' : ''}`, amount: bathCost });
  }

  const chosen = Array.isArray(addons) ? addons : [];
  for (const a of CONFIG.addons) {
    if (chosen.includes(a.id)) breakdown.push({ label: a.label, amount: a.price });
  }

  let subtotal = breakdown.reduce((sum, item) => sum + item.amount, 0);

  if (is_urgent) {
    const premium = round2(subtotal * (CONFIG.urgentMultiplier - 1));
    breakdown.push({ label: 'Urgent / express premium', amount: premium });
    subtotal += premium;
  }

  let total = round2(subtotal);
  let appliedMinimum = false;
  if (total < CONFIG.minimumCharge) {
    appliedMinimum = true;
    total = CONFIG.minimumCharge;
  }

  return { amount: total, currency: CONFIG.currency, breakdown, appliedMinimum, minimumCharge: CONFIG.minimumCharge };
}

// Public config for the booking UI (no logic, just the option lists/rates).
function publicConfig() {
  return {
    currency: CONFIG.currency,
    minimumCharge: CONFIG.minimumCharge,
    urgentMultiplier: CONFIG.urgentMultiplier,
    roomSizes: CONFIG.roomSizes,
    perBathroom: CONFIG.perBathroom,
    serviceMultipliers: CONFIG.serviceMultipliers,
    addons: CONFIG.addons
  };
}

module.exports = { computePrice, publicConfig, CONFIG, CURRENCY };
