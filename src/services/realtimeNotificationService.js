const redisService = require('../config/redis');
const notificationDeduplicationService = require('./notificationDeduplicationService');
const pushNotificationService = require('./pushNotificationService');
const logger = require('../utils/logger');

/**
 * RealtimeNotificationService
 *
 * Handles real-time notification delivery across multiple server instances
 * using Redis pub/sub. Ensures notifications are delivered in real-time
 * to tens of thousands of users without duplicates.
 *
 * Features:
 * - Redis pub/sub for cross-server communication
 * - Alert deduplication
 * - Batch processing
 * - Rate limiting
 * - WebSocket integration
 */
class RealtimeNotificationService {
  constructor() {
    this.websocketService = null;
    this.isInitialized = false;
    this.channels = {
      USER_NOTIFICATION: 'notification:user:',
      BROADCAST_NOTIFICATION: 'notification:broadcast',
      ALERT_TRIGGERED: 'alert:triggered',
      PRICE_UPDATE: 'price:update',
    };
  }

  /**
   * Initialize the service and set up pub/sub listeners
   * @param {object} websocketService - WebSocket service instance
   */
  async initialize(websocketService) {
    if (this.isInitialized) {
      logger.warn('RealtimeNotificationService already initialized');
      return;
    }

    try {
      this.websocketService = websocketService;

      // Initialize Redis if not already done
      if (!redisService.isConnected) {
        redisService.initialize();
      }

      // Set up pub/sub listeners
      await this.setupSubscriptions();

      this.isInitialized = true;
      logger.info('RealtimeNotificationService initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize RealtimeNotificationService:', error);
      throw error;
    }
  }

  /**
   * Set up Redis pub/sub subscriptions
   */
  async setupSubscriptions() {
    const subscriber = redisService.getSubscriber();

    // Subscribe to broadcast notifications
    await subscriber.subscribe(this.channels.BROADCAST_NOTIFICATION);

    // Subscribe to alert triggered events
    await subscriber.subscribe(this.channels.ALERT_TRIGGERED);

    // Handle incoming messages
    subscriber.on('message', async (channel, message) => {
      try {
        const data = JSON.parse(message);
        await this.handleIncomingMessage(channel, data);
      } catch (error) {
        logger.error('Error handling pub/sub message:', error);
      }
    });

    // Subscribe to user-specific notifications using pattern
    await subscriber.psubscribe(`${this.channels.USER_NOTIFICATION}*`);

    subscriber.on('pmessage', async (pattern, channel, message) => {
      try {
        const data = JSON.parse(message);
        await this.handleIncomingMessage(channel, data);
      } catch (error) {
        logger.error('Error handling pub/sub pattern message:', error);
      }
    });

    logger.info('Redis pub/sub subscriptions set up successfully');
  }

  /**
   * Handle incoming pub/sub messages
   * @param {string} channel - Channel name
   * @param {object} data - Message data
   */
  async handleIncomingMessage(channel, data) {
    try {
      if (channel === this.channels.BROADCAST_NOTIFICATION) {
        // Broadcast to all connected clients on this server
        this.websocketService?.broadcastToAll(data.event, data.payload);
      } else if (channel === this.channels.ALERT_TRIGGERED) {
        // Handle triggered alert
        await this.handleTriggeredAlert(data);
      } else if (channel.startsWith(this.channels.USER_NOTIFICATION)) {
        // Extract userId from channel name
        const userId = channel.replace(this.channels.USER_NOTIFICATION, '');
        // Broadcast to specific user on this server
        this.websocketService?.broadcastToUser(userId, data.event, data.payload);
      }
    } catch (error) {
      logger.error('Error handling incoming message:', error);
    }
  }

  /**
   * Send notification to a specific user across all servers
   * @param {number} userId - User ID
   * @param {string} event - Event name
   * @param {object} payload - Event payload
   * @param {object} options - Additional options (dedupe, etc.)
   * @returns {Promise<object>} Result object
   */
  async sendToUser(userId, event, payload, options = {}) {
    const { dedupe = true, type = 'general', sendPush = true, deviceTokens = null } = options;

    try {
      // Deduplication if enabled
      if (dedupe) {
        const result = await notificationDeduplicationService.processNotification(
          userId,
          type,
          payload,
          async () => {
            // Publish to Redis pub/sub (WebSocket)
            await this.publishUserNotification(userId, event, payload);

            // Send Firebase push notification if enabled
            if (sendPush && pushNotificationService.isInitialized) {
              await this.sendPushNotificationToUser(userId, event, payload, deviceTokens);
            }

            return { websocket: true, push: sendPush };
          }
        );

        if (!result.success) {
          logger.info(`Notification not sent: ${result.reason}`, { userId, event });
          return result;
        }

        return result;
      } else {
        // Send without deduplication
        await this.publishUserNotification(userId, event, payload);

        if (sendPush && pushNotificationService.isInitialized) {
          await this.sendPushNotificationToUser(userId, event, payload, deviceTokens);
        }

        return { success: true };
      }
    } catch (error) {
      logger.error('Error sending notification to user:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Send Firebase push notification to user
   * @param {number} userId - User ID
   * @param {string} event - Event name
   * @param {object} payload - Notification payload
   * @param {Array} deviceTokens - Optional device tokens
   */
  async sendPushNotificationToUser(userId, event, payload, deviceTokens = null) {
    try {
      // If no device tokens provided, get from user preferences
      if (!deviceTokens) {
        const NotificationPreferences = require('../models/NotificationPreferences');
        const preferences = await NotificationPreferences.getPreferences(userId);
        deviceTokens = preferences.device_tokens || [];
      }

      if (deviceTokens.length === 0) {
        logger.debug(`No device tokens for user ${userId}, skipping push notification`);
        return;
      }

      // Format notification for Firebase
      const notification = {
        title: payload.title || this.getDefaultTitle(event),
        body: payload.message || payload.body || JSON.stringify(payload),
        icon: payload.icon || 'default_icon',
      };

      // Send via Firebase
      const result = await pushNotificationService.sendPushNotification(
        deviceTokens,
        notification,
        {
          event,
          ...payload,
          userId,
        }
      );

      if (result.success) {
        logger.info(`Push notification sent to user ${userId} (${result.response.successCount}/${deviceTokens.length} devices)`);
      } else {
        logger.warn(`Push notification failed for user ${userId}:`, result.error);
      }
    } catch (error) {
      logger.error('Error sending push notification:', error);
    }
  }

  /**
   * Get default title for event type
   * @param {string} event - Event name
   * @returns {string} Default title
   */
  getDefaultTitle(event) {
    const titles = {
      'price_alert': 'Price Alert',
      'alert_triggered': 'Price Alert Triggered',
      'order_update': 'Order Update',
      'trade_executed': 'Trade Executed',
      'account_update': 'Account Update',
      'security_alert': 'Security Alert',
      'kyc_update': 'KYC Update',
    };

    return titles[event] || 'Notification';
  }

  /**
   * Publish user notification to Redis
   * @param {number} userId - User ID
   * @param {string} event - Event name
   * @param {object} payload - Event payload
   * @returns {Promise<void>}
   */
  async publishUserNotification(userId, event, payload) {
    const publisher = redisService.getPublisher();
    const channel = `${this.channels.USER_NOTIFICATION}${userId}`;
    const message = JSON.stringify({
      event,
      payload,
      timestamp: Date.now(),
    });

    await publisher.publish(channel, message);
    logger.debug(`Published notification to channel ${channel}`);
  }

  /**
   * Broadcast notification to all users across all servers
   * @param {string} event - Event name
   * @param {object} payload - Event payload
   * @returns {Promise<void>}
   */
  async broadcastToAll(event, payload) {
    try {
      const publisher = redisService.getPublisher();
      const message = JSON.stringify({
        event,
        payload,
        timestamp: Date.now(),
      });

      await publisher.publish(this.channels.BROADCAST_NOTIFICATION, message);
      logger.debug('Broadcasted notification to all servers');
    } catch (error) {
      logger.error('Error broadcasting to all:', error);
      throw error;
    }
  }

  /**
   * Handle triggered alert
   * @param {object} alertData - Alert data
   */
  async handleTriggeredAlert(alertData) {
    try {
      const { userId, alertId, symbol, currentPrice, targetPrice, condition } = alertData;

      // Send real-time notification to user
      await this.sendToUser(
        userId,
        'alert_triggered',
        {
          alertId,
          symbol,
          currentPrice,
          targetPrice,
          condition,
          message: `${symbol} has ${condition.replace('_', ' ')} $${targetPrice}. Current price: $${currentPrice}`,
        },
        {
          type: 'price_alert',
          dedupe: true,
        }
      );

      logger.info(`Handled triggered alert for user ${userId}:`, { symbol, alertId });
    } catch (error) {
      logger.error('Error handling triggered alert:', error);
    }
  }

  /**
   * Publish alert triggered event
   * @param {object} alertData - Alert data
   * @returns {Promise<void>}
   */
  async publishAlertTriggered(alertData) {
    try {
      const publisher = redisService.getPublisher();
      const message = JSON.stringify({
        ...alertData,
        timestamp: Date.now(),
      });

      await publisher.publish(this.channels.ALERT_TRIGGERED, message);
      logger.debug('Published alert triggered event');
    } catch (error) {
      logger.error('Error publishing alert triggered:', error);
      throw error;
    }
  }

  /**
   * Send batch notifications efficiently
   * @param {Array} notifications - Array of {userId, event, payload}
   * @param {object} options - Batch options
   * @returns {Promise<object>} Batch result
   */
  async sendBatch(notifications, options = {}) {
    const { dedupe = true, type = 'general', concurrency = 10 } = options;

    const results = {
      success: 0,
      failed: 0,
      duplicate: 0,
      rateLimit: 0,
      errors: [],
    };

    try {
      // Process in chunks to avoid overwhelming the system
      for (let i = 0; i < notifications.length; i += concurrency) {
        const chunk = notifications.slice(i, i + concurrency);

        await Promise.allSettled(
          chunk.map(async (notification) => {
            const result = await this.sendToUser(
              notification.userId,
              notification.event,
              notification.payload,
              { dedupe, type }
            );

            if (result.success) {
              results.success++;
            } else {
              if (result.reason === 'duplicate') results.duplicate++;
              else if (result.reason === 'rate_limit') results.rateLimit++;
              else results.failed++;

              if (result.error) {
                results.errors.push({
                  userId: notification.userId,
                  error: result.error,
                });
              }
            }
          })
        );

        // Small delay between chunks
        if (i + concurrency < notifications.length) {
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      }

      logger.info('Batch notification results:', results);
      return results;
    } catch (error) {
      logger.error('Error sending batch notifications:', error);
      throw error;
    }
  }

  /**
   * Send order notification
   * @param {number} userId - User ID
   * @param {object} orderData - Order data
   * @returns {Promise<object>} Result
   */
  async sendOrderNotification(userId, orderData) {
    return this.sendToUser(
      userId,
      'order_update',
      {
        orderId: orderData.id,
        symbol: orderData.symbol,
        side: orderData.side,
        quantity: orderData.quantity,
        status: orderData.status,
        filledAt: orderData.filled_at,
        fillPrice: orderData.fill_price,
      },
      {
        type: 'order_notification',
        dedupe: true,
      }
    );
  }

  /**
   * Send price alert notification
   * @param {number} userId - User ID
   * @param {object} alertData - Alert data
   * @returns {Promise<object>} Result
   */
  async sendPriceAlert(userId, alertData) {
    return this.sendToUser(
      userId,
      'price_alert',
      {
        symbol: alertData.symbol,
        currentPrice: alertData.currentPrice,
        targetPrice: alertData.targetPrice,
        condition: alertData.condition,
      },
      {
        type: 'price_alert',
        dedupe: true,
      }
    );
  }

  /**
   * Get service statistics
   * @returns {Promise<object>} Statistics
   */
  async getStats() {
    try {
      const dedupeStats = await notificationDeduplicationService.getStats();

      return {
        isInitialized: this.isInitialized,
        websocketConnections: this.websocketService?.connectedClients?.size || 0,
        ...dedupeStats,
      };
    } catch (error) {
      logger.error('Error getting stats:', error);
      return { error: error.message };
    }
  }

  /**
   * Shutdown service
   */
  async shutdown() {
    try {
      const subscriber = redisService.getSubscriber();
      await subscriber.unsubscribe();
      await subscriber.punsubscribe();
      this.isInitialized = false;
      logger.info('RealtimeNotificationService shut down');
    } catch (error) {
      logger.error('Error shutting down RealtimeNotificationService:', error);
    }
  }
}

module.exports = new RealtimeNotificationService();
