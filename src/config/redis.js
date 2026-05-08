const Redis = require('ioredis');
const logger = require('../utils/logger');

class RedisService {
  constructor() {
    this.client = null;
    this.subscriber = null;
    this.publisher = null;
    this.isConnected = false;
  }

  initialize() {
    try {
      const redisConfig = {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT) || 6379,
        password: process.env.REDIS_PASSWORD || undefined,
        db: parseInt(process.env.REDIS_DB) || 0,
        retryStrategy: (times) => {
          const delay = Math.min(times * 50, 2000);
          return delay;
        },
        maxRetriesPerRequest: 3,
        enableReadyCheck: true,
        lazyConnect: false
      };

      // Main client for general operations
      this.client = new Redis(redisConfig);

      // Separate clients for pub/sub
      this.publisher = new Redis(redisConfig);
      this.subscriber = new Redis(redisConfig);

      // Event handlers
      this.client.on('connect', () => {
        logger.info('Redis client connected');
        this.isConnected = true;
      });

      this.client.on('error', (error) => {
        logger.error('Redis client error:', error);
        this.isConnected = false;
      });

      this.client.on('close', () => {
        logger.warn('Redis client connection closed');
        this.isConnected = false;
      });

      this.publisher.on('error', (error) => {
        logger.error('Redis publisher error:', error);
      });

      this.subscriber.on('error', (error) => {
        logger.error('Redis subscriber error:', error);
      });

      logger.info('Redis service initialized');
      return { client: this.client, publisher: this.publisher, subscriber: this.subscriber };
    } catch (error) {
      logger.error('Failed to initialize Redis service:', error);
      throw error;
    }
  }

  getClient() {
    if (!this.client) {
      throw new Error('Redis client not initialized. Call initialize() first.');
    }
    return this.client;
  }

  getPublisher() {
    if (!this.publisher) {
      throw new Error('Redis publisher not initialized. Call initialize() first.');
    }
    return this.publisher;
  }

  getSubscriber() {
    if (!this.subscriber) {
      throw new Error('Redis subscriber not initialized. Call initialize() first.');
    }
    return this.subscriber;
  }

  async shutdown() {
    try {
      if (this.client) {
        await this.client.quit();
      }
      if (this.publisher) {
        await this.publisher.quit();
      }
      if (this.subscriber) {
        await this.subscriber.quit();
      }
      logger.info('Redis service shut down successfully');
    } catch (error) {
      logger.error('Error shutting down Redis service:', error);
      throw error;
    }
  }

  // Helper methods for common operations
  async set(key, value, expirySeconds = null) {
    try {
      const stringValue = typeof value === 'object' ? JSON.stringify(value) : String(value);
      if (expirySeconds) {
        return await this.client.setex(key, expirySeconds, stringValue);
      }
      return await this.client.set(key, stringValue);
    } catch (error) {
      logger.error(`Redis SET error for key ${key}:`, error);
      throw error;
    }
  }

  async get(key) {
    try {
      const value = await this.client.get(key);
      if (!value) return null;

      // Try to parse as JSON, return as string if not JSON
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    } catch (error) {
      logger.error(`Redis GET error for key ${key}:`, error);
      throw error;
    }
  }

  async del(key) {
    try {
      return await this.client.del(key);
    } catch (error) {
      logger.error(`Redis DEL error for key ${key}:`, error);
      throw error;
    }
  }

  async exists(key) {
    try {
      return await this.client.exists(key);
    } catch (error) {
      logger.error(`Redis EXISTS error for key ${key}:`, error);
      throw error;
    }
  }

  async expire(key, seconds) {
    try {
      return await this.client.expire(key, seconds);
    } catch (error) {
      logger.error(`Redis EXPIRE error for key ${key}:`, error);
      throw error;
    }
  }

  async incr(key) {
    try {
      return await this.client.incr(key);
    } catch (error) {
      logger.error(`Redis INCR error for key ${key}:`, error);
      throw error;
    }
  }

  async sadd(key, ...members) {
    try {
      return await this.client.sadd(key, ...members);
    } catch (error) {
      logger.error(`Redis SADD error for key ${key}:`, error);
      throw error;
    }
  }

  async smembers(key) {
    try {
      return await this.client.smembers(key);
    } catch (error) {
      logger.error(`Redis SMEMBERS error for key ${key}:`, error);
      throw error;
    }
  }

  async sismember(key, member) {
    try {
      return await this.client.sismember(key, member);
    } catch (error) {
      logger.error(`Redis SISMEMBER error for key ${key}:`, error);
      throw error;
    }
  }

  async srem(key, ...members) {
    try {
      return await this.client.srem(key, ...members);
    } catch (error) {
      logger.error(`Redis SREM error for key ${key}:`, error);
      throw error;
    }
  }

  async hset(key, field, value) {
    try {
      const stringValue = typeof value === 'object' ? JSON.stringify(value) : String(value);
      return await this.client.hset(key, field, stringValue);
    } catch (error) {
      logger.error(`Redis HSET error for key ${key}:`, error);
      throw error;
    }
  }

  async hget(key, field) {
    try {
      const value = await this.client.hget(key, field);
      if (!value) return null;

      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    } catch (error) {
      logger.error(`Redis HGET error for key ${key}:`, error);
      throw error;
    }
  }

  async hgetall(key) {
    try {
      const hash = await this.client.hgetall(key);
      const parsed = {};

      for (const [field, value] of Object.entries(hash)) {
        try {
          parsed[field] = JSON.parse(value);
        } catch {
          parsed[field] = value;
        }
      }

      return parsed;
    } catch (error) {
      logger.error(`Redis HGETALL error for key ${key}:`, error);
      throw error;
    }
  }

  async zadd(key, score, member) {
    try {
      return await this.client.zadd(key, score, member);
    } catch (error) {
      logger.error(`Redis ZADD error for key ${key}:`, error);
      throw error;
    }
  }

  async zrangebyscore(key, min, max) {
    try {
      return await this.client.zrangebyscore(key, min, max);
    } catch (error) {
      logger.error(`Redis ZRANGEBYSCORE error for key ${key}:`, error);
      throw error;
    }
  }

  async zremrangebyscore(key, min, max) {
    try {
      return await this.client.zremrangebyscore(key, min, max);
    } catch (error) {
      logger.error(`Redis ZREMRANGEBYSCORE error for key ${key}:`, error);
      throw error;
    }
  }
}

module.exports = new RedisService();
