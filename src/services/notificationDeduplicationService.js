const redisService = require('../config/redis');
const logger = require('../utils/logger');
const crypto = require('crypto');

/**
 * NotificationDeduplicationService
 *
 * Prevents duplicate notifications/alerts using Redis-based deduplication
 * with unique alert-id tracking and TTL-based expiration.
 *
 * Features:
 * - Alert deduplication using unique alert-id
 * - User-specific rate limiting
 * - Batch processing support
 * - Real-time notification tracking
 * - Load balancer compatible
 */
class NotificationDeduplicationService {
  constructor() {
    this.KEYS = {
      ALERT_SENT: 'alert:sent:',           // alert:sent:{alert_id}
      USER_ALERTS: 'user:alerts:',         // user:alerts:{user_id}
      ALERT_METADATA: 'alert:meta:',       // alert:meta:{alert_id}
      RATE_LIMIT: 'rate:limit:',           // rate:limit:{user_id}:{type}
      BATCH_QUEUE: 'batch:queue:',         // batch:queue:{type}
      PROCESSING_LOCK: 'lock:processing:', // lock:processing:{alert_id}
    };

    // TTL configurations (in seconds)
    this.TTL = {
      ALERT_SENT: 3600,          // 1 hour - prevent duplicate alerts
      ALERT_METADATA: 86400,     // 24 hours - keep metadata for debugging
      RATE_LIMIT: 60,            // 1 minute - rate limit window
      PROCESSING_LOCK: 30,       // 30 seconds - processing lock
      USER_ALERTS: 86400,        // 24 hours - user alert history
    };

    // Rate limit thresholds
    this.RATE_LIMITS = {
      price_alert: 10,           // Max 10 price alerts per minute
      order_notification: 20,    // Max 20 order notifications per minute
      general: 30,               // Max 30 general notifications per minute
    };
  }

  /**
   * Generate a unique alert ID based on content and user
   * @param {number} userId - User ID
   * @param {string} type - Alert type (price_alert, order_filled, etc.)
   * @param {object} data - Alert data
   * @returns {string} Unique alert ID
   */
  generateAlertId(userId, type, data) {
    const content = JSON.stringify({
      userId,
      type,
      symbol: data.symbol,
      condition: data.condition,
      targetPrice: data.targetPrice,
      timestamp: Math.floor(Date.now() / 1000), // Round to second
    });

    return crypto.createHash('sha256').update(content).digest('hex');
  }

  /**
   * Check if an alert has already been sent (deduplication)
   * @param {string} alertId - Unique alert ID
   * @returns {Promise<boolean>} True if alert was already sent
   */
  async isAlertSent(alertId) {
    try {
      const key = `${this.KEYS.ALERT_SENT}${alertId}`;
      const exists = await redisService.exists(key);
      return exists === 1;
    } catch (error) {
      logger.error('Error checking alert sent status:', error);
      // On error, allow alert to prevent blocking notifications
      return false;
    }
  }

  /**
   * Mark an alert as sent with TTL
   * @param {string} alertId - Unique alert ID
   * @param {object} metadata - Alert metadata
   * @returns {Promise<boolean>} Success status
   */
  async markAlertSent(alertId, metadata = {}) {
    try {
      const key = `${this.KEYS.ALERT_SENT}${alertId}`;
      const metaKey = `${this.KEYS.ALERT_METADATA}${alertId}`;

      // Store sent flag
      await redisService.set(key, '1', this.TTL.ALERT_SENT);

      // Store metadata for debugging
      await redisService.set(metaKey, {
        ...metadata,
        sentAt: new Date().toISOString(),
        alertId,
      }, this.TTL.ALERT_METADATA);

      logger.debug(`Alert marked as sent: ${alertId}`);
      return true;
    } catch (error) {
      logger.error('Error marking alert as sent:', error);
      return false;
    }
  }

  /**
   * Add alert to user's alert history
   * @param {number} userId - User ID
   * @param {string} alertId - Alert ID
   * @returns {Promise<boolean>} Success status
   */
  async addToUserHistory(userId, alertId) {
    try {
      const key = `${this.KEYS.USER_ALERTS}${userId}`;
      const score = Date.now(); // Use timestamp as score for sorted set

      await redisService.zadd(key, score, alertId);
      await redisService.expire(key, this.TTL.USER_ALERTS);

      return true;
    } catch (error) {
      logger.error('Error adding to user history:', error);
      return false;
    }
  }

  /**
   * Get user's recent alerts
   * @param {number} userId - User ID
   * @param {number} lastNMinutes - Look back N minutes (default 60)
   * @returns {Promise<Array>} Array of alert IDs
   */
  async getUserRecentAlerts(userId, lastNMinutes = 60) {
    try {
      const key = `${this.KEYS.USER_ALERTS}${userId}`;
      const minScore = Date.now() - (lastNMinutes * 60 * 1000);
      const maxScore = Date.now();

      return await redisService.zrangebyscore(key, minScore, maxScore);
    } catch (error) {
      logger.error('Error getting user recent alerts:', error);
      return [];
    }
  }

  /**
   * Check if user has exceeded rate limit for a notification type
   * @param {number} userId - User ID
   * @param {string} type - Notification type
   * @returns {Promise<boolean>} True if rate limit exceeded
   */
  async checkRateLimit(userId, type) {
    try {
      const key = `${this.KEYS.RATE_LIMIT}${userId}:${type}`;
      const count = await redisService.incr(key);

      // Set TTL on first increment
      if (count === 1) {
        await redisService.expire(key, this.TTL.RATE_LIMIT);
      }

      const limit = this.RATE_LIMITS[type] || this.RATE_LIMITS.general;
      const exceeded = count > limit;

      if (exceeded) {
        logger.warn(`Rate limit exceeded for user ${userId}, type ${type}: ${count}/${limit}`);
      }

      return exceeded;
    } catch (error) {
      logger.error('Error checking rate limit:', error);
      // On error, don't block notifications
      return false;
    }
  }

  /**
   * Acquire a processing lock to prevent duplicate processing
   * @param {string} alertId - Alert ID
   * @returns {Promise<boolean>} True if lock acquired
   */
  async acquireProcessingLock(alertId) {
    try {
      const key = `${this.KEYS.PROCESSING_LOCK}${alertId}`;
      // Use SET with NX (only set if not exists) and EX (expiry)
      const result = await redisService.getClient().set(
        key,
        '1',
        'EX',
        this.TTL.PROCESSING_LOCK,
        'NX'
      );

      return result === 'OK';
    } catch (error) {
      logger.error('Error acquiring processing lock:', error);
      return false;
    }
  }

  /**
   * Release a processing lock
   * @param {string} alertId - Alert ID
   * @returns {Promise<boolean>} Success status
   */
  async releaseProcessingLock(alertId) {
    try {
      const key = `${this.KEYS.PROCESSING_LOCK}${alertId}`;
      await redisService.del(key);
      return true;
    } catch (error) {
      logger.error('Error releasing processing lock:', error);
      return false;
    }
  }

  /**
   * Process a notification with deduplication and rate limiting
   * @param {number} userId - User ID
   * @param {string} type - Notification type
   * @param {object} data - Notification data
   * @param {Function} sendCallback - Callback function to send notification
   * @returns {Promise<object>} Result object
   */
  async processNotification(userId, type, data, sendCallback) {
    const alertId = this.generateAlertId(userId, type, data);

    try {
      // Step 1: Check if already sent (deduplication)
      const alreadySent = await this.isAlertSent(alertId);
      if (alreadySent) {
        logger.info(`Duplicate alert blocked: ${alertId}`);
        return {
          success: false,
          reason: 'duplicate',
          alertId,
        };
      }

      // Step 2: Acquire processing lock (prevent race conditions)
      const lockAcquired = await this.acquireProcessingLock(alertId);
      if (!lockAcquired) {
        logger.info(`Alert already being processed: ${alertId}`);
        return {
          success: false,
          reason: 'processing',
          alertId,
        };
      }

      try {
        // Step 3: Check rate limit
        const rateLimitExceeded = await this.checkRateLimit(userId, type);
        if (rateLimitExceeded) {
          return {
            success: false,
            reason: 'rate_limit',
            alertId,
          };
        }

        // Step 4: Send notification
        const result = await sendCallback();

        // Step 5: Mark as sent and add to history
        await this.markAlertSent(alertId, {
          userId,
          type,
          data,
          result,
        });

        await this.addToUserHistory(userId, alertId);

        logger.info(`Notification sent successfully: ${alertId}`);
        return {
          success: true,
          alertId,
          result,
        };

      } finally {
        // Always release lock
        await this.releaseProcessingLock(alertId);
      }

    } catch (error) {
      logger.error('Error processing notification:', error);
      await this.releaseProcessingLock(alertId);
      return {
        success: false,
        reason: 'error',
        error: error.message,
        alertId,
      };
    }
  }

  /**
   * Add notification to batch queue for processing
   * @param {string} type - Batch type
   * @param {object} notification - Notification data
   * @returns {Promise<number>} Queue length
   */
  async addToBatchQueue(type, notification) {
    try {
      const key = `${this.KEYS.BATCH_QUEUE}${type}`;
      const payload = JSON.stringify({
        ...notification,
        queuedAt: Date.now(),
      });

      return await redisService.getClient().rpush(key, payload);
    } catch (error) {
      logger.error('Error adding to batch queue:', error);
      throw error;
    }
  }

  /**
   * Get batch of notifications from queue
   * @param {string} type - Batch type
   * @param {number} batchSize - Number of items to retrieve
   * @returns {Promise<Array>} Array of notifications
   */
  async getBatchFromQueue(type, batchSize = 100) {
    try {
      const key = `${this.KEYS.BATCH_QUEUE}${type}`;
      const items = await redisService.getClient().lpop(key, batchSize);

      if (!items || items.length === 0) {
        return [];
      }

      return items.map(item => JSON.parse(item));
    } catch (error) {
      logger.error('Error getting batch from queue:', error);
      return [];
    }
  }

  /**
   * Clean up old alerts from user history
   * @param {number} userId - User ID
   * @param {number} olderThanMinutes - Remove alerts older than N minutes
   * @returns {Promise<number>} Number of alerts removed
   */
  async cleanupUserAlerts(userId, olderThanMinutes = 1440) {
    try {
      const key = `${this.KEYS.USER_ALERTS}${userId}`;
      const maxScore = Date.now() - (olderThanMinutes * 60 * 1000);

      return await redisService.zremrangebyscore(key, '-inf', maxScore);
    } catch (error) {
      logger.error('Error cleaning up user alerts:', error);
      return 0;
    }
  }

  /**
   * Get notification statistics
   * @returns {Promise<object>} Statistics object
   */
  async getStats() {
    try {
      const client = redisService.getClient();
      const keys = await client.keys('alert:sent:*');

      return {
        totalAlertsSent: keys.length,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      logger.error('Error getting stats:', error);
      return {
        totalAlertsSent: 0,
        error: error.message,
      };
    }
  }
}

module.exports = new NotificationDeduplicationService();
