// Lightweight, zero-dependency security headers (helmet-equivalent for this app).
// Kept self-contained because the deployment environment cannot reliably reach
// the npm registry. Tune the CSP if you add new external origins.
const isProd = process.env.NODE_ENV === 'production';

// The frontend loads Socket.IO + Leaflet from CDNs and uses inline handlers,
// so the CSP is intentionally permissive about scripts/styles while still
// blocking the most dangerous vectors (framing, object embeds, base hijacking).
const CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "img-src 'self' data: https:",
  "script-src 'self' 'unsafe-inline' https://cdn.socket.io https://unpkg.com",
  "style-src 'self' 'unsafe-inline' https://unpkg.com",
  "connect-src 'self' ws: wss:",
  "font-src 'self' data:"
].join('; ');

module.exports = function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-DNS-Prefetch-Control', 'off');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', CSP);
  res.removeHeader('X-Powered-By');
  if (isProd) {
    res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  }
  next();
};
