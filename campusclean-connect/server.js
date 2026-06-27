require('dotenv').config();
const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { initDb, pool } = require('./db/database');
const sessionMiddleware = require('./session');
const securityHeaders = require('./middleware/securityHeaders');
const rateLimit = require('./middleware/rateLimit');
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const bookingRoutes = require('./routes/bookings');
const ratingRoutes = require('./routes/ratings');
const feedbackRoutes = require('./routes/feedback');
const messageRoutes = require('./routes/messages');
const statsRoutes = require('./routes/stats');
const healthRoutes = require('./routes/health');
const notificationRoutes = require('./routes/notifications');
const pricingRoutes = require('./routes/pricing');
const paymentRoutes = require('./routes/payments');
const registerSocketHandlers = require('./sockets');

const isProd = process.env.NODE_ENV === 'production';

const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.set('io', io);

// Behind a reverse proxy (e.g. nginx) so secure cookies + req.ip work correctly.
if (isProd) app.set('trust proxy', 1);

app.use(securityHeaders);
app.use(express.json({ limit: '100kb' }));
app.use(sessionMiddleware);

// Make the Express session available to Socket.IO so socket identity is derived
// from the trusted server session instead of spoofable client-supplied data.
io.engine.use(sessionMiddleware);

app.use(express.static(path.join(__dirname, 'public')));

// Throttle authentication attempts to slow brute-force / credential stuffing.
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, message: 'Too many attempts. Try again in a few minutes.' });
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/auth/verify-otp', authLimiter);
app.use('/api/auth/resend-otp', authLimiter);

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/ratings', ratingRoutes);
app.use('/api/feedback', feedbackRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/health', healthRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/pricing', pricingRoutes);
app.use('/api/payments', paymentRoutes);

registerSocketHandlers(io);

app.use((err, req, res, next) => {
  console.error(err);
  if (err.code === 'ECONNREFUSED' || err.code === 'ER_ACCESS_DENIED_ERROR') {
    return res.status(503).json({ error: 'Database unavailable. Check MySQL is running and .env settings.' });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request body is too large.' });
  }
  // Avoid leaking internal error details (stack, SQL, etc.) to clients in production.
  const status = err.status || 500;
  const message = isProd ? 'Something went wrong. Please try again.' : (err.message || 'Server error.');
  res.status(status).json({ error: message });
});

const PORT = process.env.PORT || 3000;

initDb()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`CampusClean Connect → http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Failed to start:', err.message);
    console.error('Ensure MySQL is running. Copy .env.example to .env and set DB credentials.');
    process.exit(1);
  });

// Graceful shutdown: stop accepting connections, then close the DB pool.
function shutdown(signal) {
  console.log(`\n${signal} received — shutting down gracefully...`);
  server.close(() => {
    io.close();
    pool.end().finally(() => {
      console.log('Closed server and database pool. Bye.');
      process.exit(0);
    });
  });
  // Force-exit if something hangs.
  setTimeout(() => process.exit(1), 10_000).unref();
}
['SIGINT', 'SIGTERM'].forEach((sig) => process.on(sig, () => shutdown(sig)));
