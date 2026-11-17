/** In-memory ring buffer of recent mock requests, newest first. */
export function createLogBuffer(limit = 300) {
  let items = [];
  return {
    async add(entry) {
      items.unshift(entry);
      if (items.length > limit) items.length = limit;
    },
    list: async () => items,
    async clear() {
      items = [];
    },
  };
}

/**
 * Request log shared by every serverless instance. Writes are rate-limited per instance
 * (`perSecond`), so a burst of traffic to public mock URLs cannot run up Redis usage.
 */
export function redisLogBuffer(redis, { key = 'mockforge:logs', limit = 300, perSecond = 10 } = {}) {
  let windowStart = 0;
  let written = 0;
  return {
    async add(entry) {
      const now = Date.now();
      if (now - windowStart >= 1000) {
        windowStart = now;
        written = 0;
      }
      if (++written > perSecond) return;
      await redis.pipeline().lpush(key, entry).ltrim(key, 0, limit - 1).exec();
    },
    list: () => redis.lrange(key, 0, limit - 1),
    async clear() {
      await redis.del(key);
    },
  };
}
