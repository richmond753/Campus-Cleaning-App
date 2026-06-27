const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { queryOne, execute } = require('../db/database');
const mailer = require('./mailer');

const OTP_TTL_MINUTES = 10;
const MAX_ATTEMPTS = 5;

// Cryptographically-secure 6-digit code (000000–999999), always 6 chars.
function generateCode() {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
}

// Creates a fresh OTP for a user/purpose, invalidating any earlier unused ones,
// and returns the PLAIN code (only the hash is stored).
async function createOtp(userId, purpose = 'signup') {
  await execute(
    `UPDATE otp_codes SET consumed_at = NOW() WHERE user_id = ? AND purpose = ? AND consumed_at IS NULL`,
    [userId, purpose]
  );
  const code = generateCode();
  const codeHash = bcrypt.hashSync(code, 10);
  await execute(
    `INSERT INTO otp_codes (user_id, code_hash, purpose, expires_at)
     VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL ? MINUTE))`,
    [userId, codeHash, purpose, OTP_TTL_MINUTES]
  );
  return code;
}

// Verifies a submitted code. Returns { ok, reason } where reason is a
// human-readable message when ok is false.
async function verifyOtp(userId, code, purpose = 'signup') {
  const cleaned = String(code || '').trim();
  if (!/^\d{6}$/.test(cleaned)) return { ok: false, reason: 'Enter the 6-digit code.' };

  const row = await queryOne(
    `SELECT * FROM otp_codes
     WHERE user_id = ? AND purpose = ? AND consumed_at IS NULL
     ORDER BY id DESC LIMIT 1`,
    [userId, purpose]
  );
  if (!row) return { ok: false, reason: 'No active code. Request a new one.' };
  if (new Date(row.expires_at).getTime() < Date.now()) {
    return { ok: false, reason: 'That code has expired. Request a new one.' };
  }
  if (row.attempts >= MAX_ATTEMPTS) {
    return { ok: false, reason: 'Too many attempts. Request a new code.' };
  }

  if (!bcrypt.compareSync(cleaned, row.code_hash)) {
    await execute(`UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ?`, [row.id]);
    const left = MAX_ATTEMPTS - (row.attempts + 1);
    return { ok: false, reason: left > 0 ? `Incorrect code. ${left} attempt(s) left.` : 'Too many attempts. Request a new code.' };
  }

  await execute(`UPDATE otp_codes SET consumed_at = NOW() WHERE id = ?`, [row.id]);
  return { ok: true };
}

function otpEmailHtml(code) {
  return `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;padding:24px;border:1px solid #e2e8f0;border-radius:12px;">
    <h2 style="color:#0f766e;margin:0 0 8px;">CampusClean Connect</h2>
    <p style="color:#334155;">Use this code to verify your account:</p>
    <div style="font-size:32px;font-weight:800;letter-spacing:10px;color:#0f172a;background:#f1f5f9;border-radius:10px;padding:16px;text-align:center;margin:16px 0;">${code}</div>
    <p style="color:#64748b;font-size:13px;">This code expires in ${OTP_TTL_MINUTES} minutes. If you didn't request it, you can ignore this email.</p>
  </div>`;
}

// Delivery is free and degrades gracefully:
//  1) Always log the code server-side.
//  2) If SMTP is configured (e.g. free Gmail App Password) and the user has an
//     email, send a real email.
//  3) Outside production the code is also returned to the client (see auth.js)
//     so it can be shown in-app — handy for demos with no email set up.
async function deliverOtp(user, code, purpose = 'signup') {
  const target = user.email || user.phone || user.username;
  console.log(`[OTP] ${purpose} code for ${user.username} (${target}): ${code} (valid ${OTP_TTL_MINUTES} min)`);

  if (user.email && mailer.isConfigured()) {
    try {
      await mailer.sendMail({
        to: user.email,
        subject: `Your CampusClean verification code: ${code}`,
        text: `Your CampusClean verification code is ${code}. It expires in ${OTP_TTL_MINUTES} minutes.`,
        html: otpEmailHtml(code)
      });
      console.log(`[OTP] emailed code to ${user.email}`);
    } catch (err) {
      console.error('[OTP] email delivery failed:', err.message);
    }
  }
}

const isProd = () => process.env.NODE_ENV === 'production';

module.exports = { createOtp, verifyOtp, deliverOtp, generateCode, OTP_TTL_MINUTES, isProd };
