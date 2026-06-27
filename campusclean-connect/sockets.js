const { execute, queryOne } = require('./db/database');
const { createNotification } = require('./services/notifications');

// Confirms the given user is allowed to view/participate in a booking's room.
// Admins see everything; students/lecturers must own the booking; cleaners must
// be assigned to it. Returns the booking row when permitted, otherwise null.
async function authorizeBooking(bookingId, userId, role) {
  if (!bookingId || !userId) return null;
  const booking = await queryOne('SELECT id, student_id, cleaner_id FROM bookings WHERE id = ?', [bookingId]);
  if (!booking) return null;
  if (role === 'admin') return booking;
  if (booking.student_id === userId) return booking;
  if (booking.cleaner_id === userId) return booking;
  return null;
}

module.exports = function registerSocketHandlers(io) {
  io.on('connection', (socket) => {
    // Identity comes from the trusted Express session (shared via io.engine.use),
    // NOT from client-supplied handshake data which can be spoofed.
    const sessionUser = socket.request.session?.user;
    if (!sessionUser) {
      // Unauthenticated sockets can't do anything meaningful here.
      socket.disconnect(true);
      return;
    }

    socket.userId = Number(sessionUser.id);
    socket.role = sessionUser.role;
    socket.fullName = sessionUser.full_name;
    socket.join(`user_${socket.userId}`);

    socket.on('chat:join', async ({ bookingId }) => {
      const booking = await authorizeBooking(bookingId, socket.userId, socket.role);
      if (booking) socket.join(`booking_${bookingId}`);
    });

    socket.on('chat:message', async ({ bookingId, message }) => {
      if (!bookingId || !message || !message.trim()) return;
      const text = message.trim().slice(0, 2000);
      const booking = await authorizeBooking(bookingId, socket.userId, socket.role);
      if (!booking) return;
      try {
        const result = await execute(
          `INSERT INTO messages (booking_id, sender_id, sender_role, message) VALUES (?, ?, ?, ?)`,
          [bookingId, socket.userId, socket.role, text]
        );
        io.to(`booking_${bookingId}`).emit('chat:message', {
          id: result.insertId,
          booking_id: bookingId,
          sender_id: socket.userId,
          sender_role: socket.role,
          sender_name: socket.fullName,
          message: text,
          created_at: new Date().toISOString()
        });

        // Notify the other participant so they see it even when the chat isn't open.
        const recipientId = booking.student_id === socket.userId ? booking.cleaner_id : booking.student_id;
        if (recipientId) {
          const link = recipientId === booking.cleaner_id ? '/cleaner-dashboard.html#messages' : '/dashboard.html#bookings';
          await createNotification(io, recipientId, {
            title: `New message from ${socket.fullName || 'someone'}`,
            body: text.slice(0, 120),
            type: 'chat',
            link
          });
        }
      } catch (err) {
        console.error('Chat save error:', err.message);
      }
    });

    socket.on('location:update', async ({ bookingId, lat, lng }) => {
      // Only the assigned cleaner may publish their location.
      if (socket.role !== 'cleaner' || lat == null || lng == null) return;
      const nlat = Number(lat);
      const nlng = Number(lng);
      if (!Number.isFinite(nlat) || !Number.isFinite(nlng) || Math.abs(nlat) > 90 || Math.abs(nlng) > 180) return;
      try {
        await execute(
          `UPDATE cleaner_profiles SET current_lat = ?, current_lng = ?, location_updated_at = NOW() WHERE user_id = ?`,
          [nlat, nlng, socket.userId]
        );
        if (bookingId) {
          const booking = await authorizeBooking(bookingId, socket.userId, socket.role);
          if (booking) {
            io.to(`booking_${bookingId}`).emit('location:broadcast', { cleanerId: socket.userId, lat: nlat, lng: nlng, bookingId });
          }
        }
      } catch (err) {
        console.error('Location update error:', err.message);
      }
    });
  });
};
