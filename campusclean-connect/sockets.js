const db = require('./db/database');

module.exports = function registerSocketHandlers(io) {
  io.on('connection', (socket) => {
    const { userId, role, fullName } = socket.handshake.auth || {};

    if (userId) {
      socket.userId = Number(userId);
      socket.role = role;
      socket.fullName = fullName;
      socket.join(`user_${socket.userId}`); // personal room for direct notifications
    }

    // Join the chat thread tied to a specific booking
    socket.on('chat:join', ({ bookingId }) => {
      if (!bookingId) return;
      socket.join(`booking_${bookingId}`);
    });

    // Send + persist a chat message scoped to a booking
    socket.on('chat:message', ({ bookingId, message }) => {
      if (!socket.userId || !bookingId || !message || !message.trim()) return;

      const result = db.prepare(`
        INSERT INTO messages (booking_id, sender_id, sender_role, message)
        VALUES (?, ?, ?, ?)
      `).run(bookingId, socket.userId, socket.role, message.trim());

      const saved = {
        id: result.lastInsertRowid,
        booking_id: bookingId,
        sender_id: socket.userId,
        sender_role: socket.role,
        sender_name: socket.fullName,
        message: message.trim(),
        created_at: new Date().toISOString()
      };

      io.to(`booking_${bookingId}`).emit('chat:message', saved);
    });

    // Cleaner shares live GPS position while en route to a job
    socket.on('location:update', ({ bookingId, lat, lng }) => {
      if (!socket.userId || lat == null || lng == null) return;

      db.prepare(`
        UPDATE cleaner_profiles
        SET current_lat = ?, current_lng = ?, location_updated_at = datetime('now')
        WHERE user_id = ?
      `).run(lat, lng, socket.userId);

      if (bookingId) {
        io.to(`booking_${bookingId}`).emit('location:broadcast', {
          cleanerId: socket.userId,
          lat,
          lng,
          bookingId
        });
      }
    });

    socket.on('disconnect', () => {
      // Intentionally no-op: availability is an explicit toggle, not tied to socket connection,
      // so a dropped connection doesn't wrongly flip a cleaner's status.
    });
  });
};
