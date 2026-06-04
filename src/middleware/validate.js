import { cache } from "../utils/cache.js";

/**
 * Validates that ?pincode is a 6-digit Indian pincode.
 * Also accepts pincode in request body for POST requests.
 */
export function validatePincode(req, res, next) {
  const pincode = req.query.pincode || req.body?.pincode;

  if (!pincode) {
    return res.status(400).json({
      success: false,
      error: "pincode is required",
      code: "MISSING_PINCODE",
      example: "/api/blinkit/search?pincode=400001&query=milk",
    });
  }

  if (!/^\d{6}$/.test(String(pincode))) {
    return res.status(400).json({
      success: false,
      error: "pincode must be a 6-digit number",
      code: "INVALID_PINCODE_FORMAT",
    });
  }

  next();
}

/**
 * Validates that ?query is present and not too short or too long.
 */
export function validateQuery(req, res, next) {
  const query = req.query.query;

  if (!query || !query.trim()) {
    return res.status(400).json({
      success: false,
      error: "query is required",
      code: "MISSING_QUERY",
      example: "/api/blinkit/search?pincode=400001&query=amul+milk",
    });
  }

  if (query.trim().length < 2) {
    return res.status(400).json({
      success: false,
      error: "query must be at least 2 characters",
      code: "QUERY_TOO_SHORT",
    });
  }

  if (query.trim().length > 100) {
    return res.status(400).json({
      success: false,
      error: "query must be under 100 characters",
      code: "QUERY_TOO_LONG",
    });
  }

  next();
}

/**
 * Simple IP-based rate limiter.
 * Limits each IP to 30 requests per minute to avoid hammering Blinkit.
 *
 * For production use express-rate-limit + Redis instead:
 *   npm install express-rate-limit rate-limit-redis
 */
export function rateLimiter(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress;
  const key = `ratelimit:${ip}`;
  const windowMs = 60 * 1000; // 1 minute
  const maxRequests = 30;

  const entry = cache.get(key) || { count: 0, resetAt: Date.now() + windowMs };

  if (Date.now() > entry.resetAt) {
    entry.count = 0;
    entry.resetAt = Date.now() + windowMs;
  }

  entry.count++;
  cache.set(key, entry, windowMs);

  // Set rate limit headers
  res.set({
    "X-RateLimit-Limit": maxRequests,
    "X-RateLimit-Remaining": Math.max(0, maxRequests - entry.count),
    "X-RateLimit-Reset": Math.ceil(entry.resetAt / 1000),
  });

  if (entry.count > maxRequests) {
    return res.status(429).json({
      success: false,
      error: "Too many requests — please wait a minute",
      code: "RATE_LIMITED",
      retryAfter: Math.ceil((entry.resetAt - Date.now()) / 1000),
    });
  }

  next();
}
