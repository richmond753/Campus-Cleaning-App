const { query, queryOne, execute } = require('../db/database');

// Persists a notification for a user and pushes it in real time to any of their
// connected sockets (joined to the `user_<id>` room on connect). Failures are
// swallowed/logged so notifications never break the primary request flow.
async function createNotification(io, userId, { title, body = null, type = 'info', link = null }) {
  if (!userId || !title) return null;
  try {
    const result = await execute(
      `INSERT INTO notifications (user_id, title, body, type, link) VALUES (?, ?, ?, ?, ?)`,
      [userId, title, body, type, link]
    );
    const row = await queryOne('SELECT * FROM notifications WHERE id = ?', [result.insertId]);
    if (io && row) io.to(`user_${userId}`).emit('notification:new', row);
    return row;
  } catch (err) {
    console.error('Notification create error:', err.message);
    return null;
  }
}

// Sends the same notification to every active admin (e.g. new signups,
// new feedback). Each admin gets their own persisted row + live push.
async function notifyAdmins(io, payload) {
  try {
    const admins = await query(`SELECT id FROM users WHERE role = 'admin' AND status = 'active'`);
    await Promise.all(admins.map((a) => createNotification(io, a.id, payload)));
  } catch (err) {
    console.error('notifyAdmins error:', err.message);
  }
}

module.exports = { createNotification, notifyAdmins };
