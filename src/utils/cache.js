/**
 * Simple in-memory cache with TTL support.
 * For production, swap this for Redis:
 *   npm install ioredis
 *   const redis = new Redis(process.env.REDIS_URL)
 *   await redis.set(key, JSON.stringify(value), "EX", ttlSeconds)
 *   const cached = JSON.parse(await redis.get(key))
 */

const store = new Map();

export const cache = {
  get(key) {
    const entry = store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      store.delete(key);
      return null;
    }
    return entry.value;
  },

  set(key, value, ttlMs = 30 * 60 * 1000) {
    store.set(key, {
      value,
      expiresAt: Date.now() + ttlMs,
    });
  },

  delete(key) {
    store.delete(key);
  },

  // Clear all expired entries (run periodically)
  cleanup() {
    const now = Date.now();
    for (const [key, entry] of store.entries()) {
      if (now > entry.expiresAt) store.delete(key);
    }
  },

  size() {
    return store.size;
  },
};

// Auto-cleanup every 10 minutes
setInterval(() => cache.cleanup(), 10 * 60 * 1000);
