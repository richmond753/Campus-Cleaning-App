// Minimal in-memory fixed-window rate limiter (zero dependencies).
// Suitable for a single-process deployment. If you scale to multiple
// instances, swap the Map for a shared store (e.g. Redis).
function rateLimit({ windowMs = 60_000, max = 60, message = 'Too many requests. Please slow down.' } = {}) {
  const hits = new Map(); // key -> { count, resetAt }

  // Periodically evict expired buckets so the Map doesn't grow unbounded.
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) {
      if (entry.resetAt <= now) hits.delete(key);
    }
  }, windowMs);
  if (sweep.unref) sweep.unref();

  return function rateLimiter(req, res, next) {
    const now = Date.now();
    const key = req.ip || req.connection?.remoteAddress || 'unknown';
    let entry = hits.get(key);

    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(key, entry);
    }

    entry.count += 1;
    const remaining = Math.max(0, max - entry.count);
    res.setHeader('X-RateLimit-Limit', max);
    res.setHeader('X-RateLimit-Remaining', remaining);

    if (entry.count > max) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      res.setHeader('Retry-After', retryAfter);
      return res.status(429).json({ error: message });
    }
    next();
  };
}

module.exports = rateLimit;
