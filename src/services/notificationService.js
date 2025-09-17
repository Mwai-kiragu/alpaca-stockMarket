const { Notification, User } = require('../models');
const emailService = require('./emailService');
const logger = require('../utils/logger');

class NotificationService {
  constructor() {
    this.notificationQueue = [];
    this.isProcessing = false;
    this.batchSize = 10;
    this.processInterval = 5000; // 5 seconds
  }

  start() {
    if (this.isProcessing) {
      logger.warn('Notification Service is already running');
      return;
    }

    this.isProcessing = true;
    this.processQueue();
    logger.info('Notification Service started');
  }

  stop() {
    this.isProcessing = false;
    logger.info('Notification Service stopped');
  }

  async processQueue() {
    while (this.isProcessing) {
      try {
        if (this.notificationQueue.length > 0) {
          const batch = this.notificationQueue.splice(0, this.batchSize);
          await this.processBatch(batch);
        }

        await this.sleep(this.processInterval);
      } catch (error) {
        logger.error('Notification queue processing error:', error);
        await this.sleep(this.processInterval);
      }
    }
  }

  async processBatch(notifications) {
    const promises = notifications.map(notification => this.processNotification(notification));
    await Promise.allSettled(promises);
  }

  async processNotification(notificationData) {
    try {
      const { userId, type, data } = notificationData;

      // Create in-app notification
      const notification = await this.createInAppNotification(userId, type, data);

      // Get user preferences
      const user = await User.findByPk(userId, {
        attributes: ['id', 'email', 'first_name', 'notification_preferences']
      });

      if (!user) {
        logger.warn(`User ${userId} not found for notification`);
        return;
      }

      // Send email if enabled
      const emailEnabled = this.shouldSendEmail(user.notification_preferences, type);
      if (emailEnabled) {
        await this.sendEmailNotification(user, type, data);
      }

      // Send push notification if enabled (implement when push service is available)
      const pushEnabled = this.shouldSendPush(user.notification_preferences, type);
      if (pushEnabled) {
        await this.sendPushNotification(user, type, data);
      }

      logger.info(`Notification processed for user ${userId}:`, { type, notificationId: notification.id });

    } catch (error) {
      logger.error('Error processing individual notification:', error);
    }
  }

  async createInAppNotification(userId, type, data) {
    const notificationConfig = this.getNotificationConfig(type, data);

    return await Notification.create({
      user_id: userId,
      type,
      title: notificationConfig.title,
      message: notificationConfig.message,
      priority: notificationConfig.priority,
      is_read: false,
      metadata: {
        ...data,
        createdBy: 'system',
        timestamp: new Date().toISOString()
      },
      action_url: notificationConfig.actionUrl
    });
  }

  getNotificationConfig(type, data) {
    const configs = {
      order_filled: {
        title: `Order Filled - ${data.symbol}`,
        message: `Your ${data.side} order for ${data.quantity} shares of ${data.symbol} has been filled at $${data.price}`,
        priority: 'high',
        actionUrl: `/orders/${data.orderId}`
      },
      order_canceled: {
        title: `Order Canceled - ${data.symbol}`,
        message: `Your ${data.side} order for ${data.quantity} shares of ${data.symbol} has been canceled`,
        priority: 'medium',
        actionUrl: `/orders/${data.orderId}`
      },
      order_rejected: {
        title: `Order Rejected - ${data.symbol}`,
        message: `Your ${data.side} order for ${data.quantity} shares of ${data.symbol} was rejected: ${data.reason}`,
        priority: 'high',
        actionUrl: `/orders/${data.orderId}`
      },
      price_alert_triggered: {
        title: `Price Alert Triggered - ${data.symbol}`,
        message: `${data.symbol} has ${data.condition.replace('_', ' ')} your target price of $${data.targetPrice}. Current price: $${data.currentPrice}`,
        priority: 'high',
        actionUrl: `/stocks/${data.symbol}`
      },
      deposit_completed: {
        title: 'Deposit Completed',
        message: `Your deposit of ${data.currency} ${data.amount} has been completed successfully`,
        priority: 'medium',
        actionUrl: '/wallet'
      },
      deposit_failed: {
        title: 'Deposit Failed',
        message: `Your deposit of ${data.currency} ${data.amount} has failed. Please try again.`,
        priority: 'high',
        actionUrl: '/wallet'
      },
      withdrawal_completed: {
        title: 'Withdrawal Completed',
        message: `Your withdrawal of ${data.currency} ${data.amount} has been processed`,
        priority: 'medium',
        actionUrl: '/wallet'
      },
      portfolio_update: {
        title: 'Portfolio Update',
        message: `Your portfolio value is now $${data.totalValue.toFixed(2)} (${data.changePercent > 0 ? '+' : ''}${data.changePercent.toFixed(2)}% today)`,
        priority: 'low',
        actionUrl: '/portfolio'
      },
      margin_call: {
        title: 'Margin Call Warning',
        message: `Your account is approaching margin requirements. Current equity: $${data.equity.toFixed(2)}`,
        priority: 'high',
        actionUrl: '/account'
      },
      account_restricted: {
        title: 'Account Restriction',
        message: `Your account has been restricted for ${data.reason}. Contact support for assistance.`,
        priority: 'high',
        actionUrl: '/support'
      },
      kyc_approved: {
        title: 'KYC Verification Approved',
        message: 'Your identity verification has been approved. You can now access all trading features.',
        priority: 'high',
        actionUrl: '/profile'
      },
      kyc_rejected: {
        title: 'KYC Verification Required',
        message: `Your identity verification needs attention: ${data.reason}`,
        priority: 'high',
        actionUrl: '/profile/kyc'
      },
      market_update: {
        title: 'Market Update',
        message: data.message || 'Important market update available',
        priority: 'low',
        actionUrl: '/updates/news'
      },
      system_maintenance: {
        title: 'System Maintenance',
        message: data.message || 'Scheduled system maintenance notification',
        priority: 'medium',
        actionUrl: null
      }
    };

    return configs[type] || {
      title: 'Trading Platform Notification',
      message: data.message || 'You have a new notification',
      priority: 'medium',
      actionUrl: null
    };
  }

  shouldSendEmail(preferences, type) {
    if (!preferences || !preferences.email) return true; // Default to true if no preferences

    const emailPrefs = preferences.email;

    // Map notification types to preference keys
    const typeMapping = {
      order_filled: 'orderFilled',
      order_canceled: 'orderCanceled',
      order_rejected: 'orderFilled',
      price_alert_triggered: 'priceAlerts',
      deposit_completed: 'portfolioUpdates',
      deposit_failed: 'portfolioUpdates',
      withdrawal_completed: 'portfolioUpdates',
      portfolio_update: 'portfolioUpdates',
      margin_call: 'systemUpdates',
      account_restricted: 'systemUpdates',
      kyc_approved: 'systemUpdates',
      kyc_rejected: 'systemUpdates',
      market_update: 'marketNews',
      system_maintenance: 'systemUpdates'
    };

    const prefKey = typeMapping[type] || 'systemUpdates';
    return emailPrefs[prefKey] !== false;
  }

  shouldSendPush(preferences, type) {
    if (!preferences || !preferences.push) return false; // Default to false for push

    const pushPrefs = preferences.push;

    const typeMapping = {
      order_filled: 'orderFilled',
      order_canceled: 'orderCanceled',
      order_rejected: 'orderFilled',
      price_alert_triggered: 'priceAlerts',
      deposit_completed: 'portfolioUpdates',
      deposit_failed: 'portfolioUpdates',
      withdrawal_completed: 'portfolioUpdates',
      portfolio_update: 'portfolioUpdates',
      margin_call: 'systemUpdates',
      account_restricted: 'systemUpdates',
      kyc_approved: 'systemUpdates',
      kyc_rejected: 'systemUpdates',
      market_update: 'marketNews',
      system_maintenance: 'systemUpdates'
    };

    const prefKey = typeMapping[type] || 'systemUpdates';
    return pushPrefs[prefKey] === true;
  }

  async sendEmailNotification(user, type, data) {
    try {
      await emailService.sendNotificationEmail(user, { type, data });
    } catch (error) {
      logger.error(`Failed to send email notification to ${user.email}:`, error);
    }
  }

  async sendPushNotification(user, type, data) {
    // Implement push notification service integration
    // This could be Firebase Cloud Messaging, Apple Push Notifications, etc.
    logger.info(`Push notification would be sent to user ${user.id} for type ${type}`);
  }

  // Public methods to queue notifications
  queueNotification(userId, type, data) {
    this.notificationQueue.push({ userId, type, data });
  }

  async sendImmediate(userId, type, data) {
    await this.processNotification({ userId, type, data });
  }

  async sendBulkNotifications(notifications) {
    notifications.forEach(notification => {
      this.notificationQueue.push(notification);
    });
  }

  // Utility methods
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  getQueueStatus() {
    return {
      queueLength: this.notificationQueue.length,
      isProcessing: this.isProcessing,
      batchSize: this.batchSize,
      processInterval: this.processInterval
    };
  }

  // Convenience methods for common notifications
  async notifyOrderFilled(userId, orderData) {
    this.queueNotification(userId, 'order_filled', orderData);
  }

  async notifyPriceAlert(userId, alertData) {
    this.queueNotification(userId, 'price_alert_triggered', alertData);
  }

  async notifyDeposit(userId, depositData) {
    const type = depositData.status === 'completed' ? 'deposit_completed' : 'deposit_failed';
    this.queueNotification(userId, type, depositData);
  }

  async notifyPortfolioUpdate(userId, portfolioData) {
    this.queueNotification(userId, 'portfolio_update', portfolioData);
  }

  async notifyMarginCall(userId, marginData) {
    await this.sendImmediate(userId, 'margin_call', marginData); // Send immediately for high priority
  }

  async broadcastSystemMessage(message, priority = 'medium') {
    try {
      const users = await User.findAll({
        attributes: ['id'],
        where: {
          is_active: true
        }
      });

      const notifications = users.map(user => ({
        userId: user.id,
        type: 'system_maintenance',
        data: { message, priority }
      }));

      await this.sendBulkNotifications(notifications);
      logger.info(`Broadcast message queued for ${users.length} users`);
    } catch (error) {
      logger.error('Failed to broadcast system message:', error);
    }
  }
}

module.exports = new NotificationService();