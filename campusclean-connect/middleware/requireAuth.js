// Usage: requireAuth() for "must be logged in",
//        requireAuth(['admin']) for "must be logged in AND have one of these roles"
function requireAuth(roles = []) {
  return (req, res, next) => {
    if (!req.session.user) {
      return res.status(401).json({ error: 'Please sign in to continue.' });
    }
    if (roles.length && !roles.includes(req.session.user.role)) {
      return res.status(403).json({ error: 'You do not have access to this action.' });
    }
    next();
  };
}

module.exports = requireAuth;
