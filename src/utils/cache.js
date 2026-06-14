const redisService = require('../config/redis');
const logger = require('./logger');

/**
 * Cache-aside helper. Checks Redis first; on miss calls fetchFn, stores result, returns it.
 * Silently falls back to fetchFn when Redis is unavailable so the app never breaks.
 *
 * @param {string} key         - Cache key
 * @param {number} ttl         - TTL in seconds
 * @param {Function} fetchFn   - Async function that returns the data to cache
 */
const withCache = async (key, ttl, fetchFn) => {
  try {
    const cached = await redisService.get(key);
    if (cached !== null && cached !== undefined) {
      return cached;
    }
  } catch (err) {
    logger.debug(`Cache read miss (Redis error) for ${key}: ${err.message}`);
  }

  const data = await fetchFn();

  if (data !== null && data !== undefined) {
    try {
      await redisService.set(key, data, ttl);
    } catch (err) {
      logger.debug(`Cache write failed for ${key}: ${err.message}`);
    }
  }

  return data;
};

/**
 * Invalidate one or more cache keys.
 */
const invalidate = async (...keys) => {
  try {
    await Promise.all(keys.map(k => redisService.del(k)));
  } catch (err) {
    logger.debug(`Cache invalidation failed: ${err.message}`);
  }
};

module.exports = { withCache, invalidate };
