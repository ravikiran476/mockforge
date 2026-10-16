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

/** Request log shared by every serverless instance. */
export function redisLogBuffer(redis, { key = 'mockforge:logs', limit = 300 } = {}) {
  return {
    async add(entry) {
      await redis.pipeline().lpush(key, entry).ltrim(key, 0, limit - 1).exec();
    },
    list: () => redis.lrange(key, 0, limit - 1),
    async clear() {
      await redis.del(key);
    },
  };
}
