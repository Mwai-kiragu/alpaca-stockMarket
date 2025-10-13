const notificationDeduplicationService = require('./notificationDeduplicationService');
const realtimeNotificationService = require('./realtimeNotificationService');
const logger = require('../utils/logger');

/**
 * BatchNotificationProcessor
 *
 * Efficiently processes notifications in batches to handle
 * tens of thousands of users without overwhelming the system.
 *
 * Features:
 * - Batch processing with configurable batch sizes
 * - Rate limiting per user
 * - Deduplication
 * - Priority queue support
 * - Automatic retry for failed notifications
 */
class BatchNotificationProcessor {
  constructor() {
    this.isProcessing = false;
    this.processingInterval = null;
    this.config = {
      batchSize: 100,              // Process 100 notifications at a time
      intervalMs: 1000,            // Process every 1 second
      maxRetries: 3,               // Retry failed notifications up to 3 times
      retryDelayMs: 5000,          // Wait 5 seconds before retry
      concurrency: 10,             // Process 10 users concurrently in batch
    };
    this.queues = {
      high: [],                    // High priority notifications
      normal: [],                  // Normal priority notifications
      low: [],                     // Low priority notifications
    };
    this.retryQueue = new Map();   // Map<alertId, {notification, retries}>
  }

  /**
   * Start the batch processor
   */
  start() {
    if (this.isProcessing) {
      logger.warn('BatchNotificationProcessor already running');
      return;
    }

    this.isProcessing = true;
    this.processingInterval = setInterval(() => {
      this.processBatch();
    }, this.config.intervalMs);

    logger.info('BatchNotificationProcessor started');
  }

  /**
   * Stop the batch processor
   */
  stop() {
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
    }

    this.isProcessing = false;
    logger.info('BatchNotificationProcessor stopped');
  }

  /**
   * Add notification to queue
   * @param {object} notification - Notification object
   * @param {string} priority - Priority level (high, normal, low)
   */
  addToQueue(notification, priority = 'normal') {
    try {
      const validPriorities = ['high', 'normal', 'low'];
      const queuePriority = validPriorities.includes(priority) ? priority : 'normal';

      this.queues[queuePriority].push({
        ...notification,
        queuedAt: Date.now(),
        priority: queuePriority,
      });

      logger.debug(`Added notification to ${queuePriority} priority queue`);
    } catch (error) {
      logger.error('Error adding to queue:', error);
    }
  }

  /**
   * Add multiple notifications to queue
   * @param {Array} notifications - Array of notification objects
   * @param {string} priority - Priority level
   */
  addBulkToQueue(notifications, priority = 'normal') {
    notifications.forEach((notification) => {
      this.addToQueue(notification, priority);
    });

    logger.info(`Added ${notifications.length} notifications to ${priority} priority queue`);
  }

  /**
   * Get next batch of notifications to process
   * @returns {Array} Batch of notifications
   */
  getNextBatch() {
    const batch = [];

    // Process high priority first
    while (batch.length < this.config.batchSize && this.queues.high.length > 0) {
      batch.push(this.queues.high.shift());
    }

    // Then normal priority
    while (batch.length < this.config.batchSize && this.queues.normal.length > 0) {
      batch.push(this.queues.normal.shift());
    }

    // Finally low priority
    while (batch.length < this.config.batchSize && this.queues.low.length > 0) {
      batch.push(this.queues.low.shift());
    }

    return batch;
  }

  /**
   * Process a batch of notifications
   */
  async processBatch() {
    try {
      // Check retry queue first
      await this.processRetries();

      const batch = this.getNextBatch();

      if (batch.length === 0) {
        return;
      }

      logger.info(`Processing batch of ${batch.length} notifications`);

      const startTime = Date.now();
      const results = await realtimeNotificationService.sendBatch(
        batch.map((n) => ({
          userId: n.userId,
          event: n.event,
          payload: n.payload,
        })),
        {
          dedupe: n.dedupe !== false,
          type: n.type || 'general',
          concurrency: this.config.concurrency,
        }
      );

      const processingTime = Date.now() - startTime;

      logger.info(`Batch processed in ${processingTime}ms:`, {
        success: results.success,
        failed: results.failed,
        duplicate: results.duplicate,
        rateLimit: results.rateLimit,
      });

      // Handle failed notifications
      if (results.failed > 0 && results.errors.length > 0) {
        this.handleFailedNotifications(batch, results.errors);
      }
    } catch (error) {
      logger.error('Error processing batch:', error);
    }
  }

  /**
   * Handle failed notifications for retry
   * @param {Array} batch - Original batch
   * @param {Array} errors - Array of errors
   */
  handleFailedNotifications(batch, errors) {
    errors.forEach((error) => {
      // Find the notification that failed
      const notification = batch.find((n) => n.userId === error.userId);

      if (notification) {
        const alertId = notificationDeduplicationService.generateAlertId(
          notification.userId,
          notification.type || 'general',
          notification.payload
        );

        // Add to retry queue
        const retryInfo = this.retryQueue.get(alertId) || { notification, retries: 0 };

        if (retryInfo.retries < this.config.maxRetries) {
          retryInfo.retries++;
          retryInfo.nextRetryAt = Date.now() + this.config.retryDelayMs;
          this.retryQueue.set(alertId, retryInfo);

          logger.debug(`Added notification to retry queue (attempt ${retryInfo.retries}/${this.config.maxRetries})`);
        } else {
          logger.error(`Notification failed after ${this.config.maxRetries} retries:`, {
            userId: notification.userId,
            event: notification.event,
          });
          this.retryQueue.delete(alertId);
        }
      }
    });
  }

  /**
   * Process retry queue
   */
  async processRetries() {
    const now = Date.now();
    const retries = [];

    for (const [alertId, retryInfo] of this.retryQueue.entries()) {
      if (retryInfo.nextRetryAt <= now) {
        retries.push(retryInfo.notification);
        this.retryQueue.delete(alertId);
      }
    }

    if (retries.length > 0) {
      logger.info(`Processing ${retries.length} retry notifications`);
      // Add retries to high priority queue
      this.addBulkToQueue(retries, 'high');
    }
  }

  /**
   * Send price alerts to multiple users
   * @param {Array} alerts - Array of {userId, symbol, currentPrice, targetPrice, condition}
   * @returns {Promise<void>}
   */
  async sendPriceAlerts(alerts) {
    const notifications = alerts.map((alert) => ({
      userId: alert.userId,
      event: 'price_alert',
      payload: {
        symbol: alert.symbol,
        currentPrice: alert.currentPrice,
        targetPrice: alert.targetPrice,
        condition: alert.condition,
        message: `${alert.symbol} has ${alert.condition.replace('_', ' ')} $${alert.targetPrice}`,
      },
      type: 'price_alert',
      dedupe: true,
    }));

    this.addBulkToQueue(notifications, 'high');
    logger.info(`Queued ${notifications.length} price alerts for batch processing`);
  }

  /**
   * Send order notifications to multiple users
   * @param {Array} orders - Array of order notifications
   * @returns {Promise<void>}
   */
  async sendOrderNotifications(orders) {
    const notifications = orders.map((order) => ({
      userId: order.userId,
      event: 'order_update',
      payload: {
        orderId: order.orderId,
        symbol: order.symbol,
        side: order.side,
        quantity: order.quantity,
        status: order.status,
        fillPrice: order.fillPrice,
      },
      type: 'order_notification',
      dedupe: true,
    }));

    this.addBulkToQueue(notifications, 'high');
    logger.info(`Queued ${notifications.length} order notifications for batch processing`);
  }

  /**
   * Send market update to all users
   * @param {object} marketData - Market data
   * @returns {Promise<void>}
   */
  async sendMarketUpdate(marketData) {
    await realtimeNotificationService.broadcastToAll('market_update', marketData);
    logger.info('Broadcasted market update to all users');
  }

  /**
   * Get queue statistics
   * @returns {object} Statistics
   */
  getStats() {
    return {
      isProcessing: this.isProcessing,
      queues: {
        high: this.queues.high.length,
        normal: this.queues.normal.length,
        low: this.queues.low.length,
        total: this.queues.high.length + this.queues.normal.length + this.queues.low.length,
      },
      retryQueue: this.retryQueue.size,
      config: this.config,
    };
  }

  /**
   * Update processor configuration
   * @param {object} config - Configuration object
   */
  updateConfig(config) {
    this.config = { ...this.config, ...config };

    // Restart processor with new interval if changed
    if (config.intervalMs && this.isProcessing) {
      this.stop();
      this.start();
    }

    logger.info('BatchNotificationProcessor config updated:', this.config);
  }

  /**
   * Clear all queues
   */
  clearQueues() {
    this.queues.high = [];
    this.queues.normal = [];
    this.queues.low = [];
    this.retryQueue.clear();
    logger.info('All notification queues cleared');
  }
}

module.exports = new BatchNotificationProcessor();
