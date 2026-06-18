const path = require('path');
const express = require('express');
const session = require('express-session');
const http = require('http');
const { Server } = require('socket.io');

const db = require('./db/database'); // also runs schema + seed on first boot
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const bookingRoutes = require('./routes/bookings');
const ratingRoutes = require('./routes/ratings');
const feedbackRoutes = require('./routes/feedback');
const messageRoutes = require('./routes/messages');
const registerSocketHandlers = require('./sockets');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Make the socket.io instance reachable from inside route handlers via req.app.get('io')
app.set('io', io);

app.use(express.json());

app.use(session({
  name: 'campusclean.sid',
  secret: process.env.SESSION_SECRET || 'campusclean-dev-secret-change-this-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 1000 * 60 * 60 * 8, // 8 hour session
    httpOnly: true
  }
}));

// Serve the static frontend (public/) — index.html, login.html, dashboards, css, js
app.use(express.static(path.join(__dirname, 'public')));

// REST API
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/ratings', ratingRoutes);
app.use('/api/feedback', feedbackRoutes);
app.use('/api/messages', messageRoutes);

// Real-time: chat + live cleaner location
registerSocketHandlers(io);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`CampusClean Connect is running → http://localhost:${PORT}`);
});
