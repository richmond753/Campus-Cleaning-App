const session = require('express-session');

const isProd = process.env.NODE_ENV === 'production';

const SESSION_SECRET = process.env.SESSION_SECRET;
if (isProd && (!SESSION_SECRET || SESSION_SECRET === 'change-this-in-production')) {
  throw new Error(
    'SESSION_SECRET must be set to a strong, unique value in production. ' +
    'Refusing to start with a default/missing secret.'
  );
}

const sessionMiddleware = session({
  name: 'campusclean.sid',
  secret: SESSION_SECRET || 'campusclean-dev-secret-change-this-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 1000 * 60 * 60 * 8,
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd
  }
});

module.exports = sessionMiddleware;
