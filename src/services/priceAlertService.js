const { Notification, User } = require('../models');
const alpacaService = require('./alpacaService');
const emailService = require('./emailService');
const batchNotificationProcessor = require('./batchNotificationProcessor');
const realtimeNotificationService = require('./realtimeNotificationService');
const redisService = require('../config/redis');
const logger = require('../utils/logger');

class PriceAlertService {
  constructor() {
    this.alertCheckInterval = null;
    this.isRunning = false;
  }

  start() {
    if (this.isRunning) {
      logger.warn('Price Alert Service is already running');
      return;
    }

    this.isRunning = true;
    this.alertCheckInterval = setInterval(() => {
      this.checkPriceAlerts();
    }, 60000); // Check every minute

    logger.info('Price Alert Service started - checking alerts every minute');
  }

  stop() {
    if (this.alertCheckInterval) {
      clearInterval(this.alertCheckInterval);
      this.alertCheckInterval = null;
    }
    this.isRunning = false;
    logger.info('Price Alert Service stopped');
  }

  async checkPriceAlerts() {
    try {
      const activeAlerts = await Notification.findAll({
        where: {
          type: 'price_alert',
          'metadata.active': true
        },
        include: [{ model: User, attributes: ['id', 'email', 'first_name', 'notification_preferences'] }]
      });

      if (activeAlerts.length === 0) {
        return;
      }

      logger.info(`Checking ${activeAlerts.length} active price alerts`);

      const alertsBySymbol = {};
      activeAlerts.forEach(alert => {
        const symbol = alert.metadata.symbol;
        if (!alertsBySymbol[symbol]) {
          alertsBySymbol[symbol] = [];
        }
        alertsBySymbol[symbol].push(alert);
      });

      for (const symbol in alertsBySymbol) {
        await this.checkSymbolAlerts(symbol, alertsBySymbol[symbol]);
      }
    } catch (error) {
      logger.error('Error checking price alerts:', error);
    }
  }

  async checkSymbolAlerts(symbol, alerts) {
    try {
      const quote = await alpacaService.getLatestQuote(symbol);
      const currentPrice = quote.ap || quote.bp;

      const triggeredAlerts = [];

      for (const alert of alerts) {
        const { condition, targetPrice, currentPrice: lastPrice } = alert.metadata;
        let isTriggered = false;

        switch (condition) {
          case 'above':
            isTriggered = currentPrice > targetPrice;
            break;
          case 'below':
            isTriggered = currentPrice < targetPrice;
            break;
          case 'crosses_up':
            isTriggered = lastPrice <= targetPrice && currentPrice > targetPrice;
            break;
          case 'crosses_down':
            isTriggered = lastPrice >= targetPrice && currentPrice < targetPrice;
            break;
        }

        // Update current price for all alerts regardless of trigger status
        await alert.update({
          metadata: {
            ...alert.metadata,
            currentPrice,
            lastChecked: new Date().toISOString()
          }
        });

        if (isTriggered) {
          triggeredAlerts.push({ alert, currentPrice });
        }
      }

      if (triggeredAlerts.length > 0) {
        await this.processTriggeredAlerts(triggeredAlerts);
      }
    } catch (error) {
      logger.error(`Error checking alerts for ${symbol}:`, error);
    }
  }

  async processTriggeredAlerts(triggeredAlerts) {
    // Batch process alerts for efficiency
    const alertsToSend = [];

    for (const { alert, currentPrice } of triggeredAlerts) {
      try {
        const user = alert.User;
        const { symbol, condition, targetPrice, assetName } = alert.metadata;

        // Mark alert as triggered in database
        await alert.update({
          metadata: {
            ...alert.metadata,
            active: false,
            triggeredAt: new Date().toISOString(),
            triggerPrice: currentPrice
          },
          is_read: false
        });

        // Create triggered alert notification
        await Notification.create({
          user_id: user.id,
          type: 'price_alert_triggered',
          title: `Price Alert Triggered - ${symbol}`,
          message: `${symbol} has ${condition.replace('_', ' ')} your target price of $${targetPrice}. Current price: $${currentPrice.toFixed(2)}`,
          priority: 'high',
          is_read: false,
          metadata: {
            symbol,
            assetName,
            condition,
            targetPrice,
            currentPrice,
            originalAlertId: alert.id,
            triggeredAt: new Date().toISOString()
          },
          action_url: `/stocks/${symbol}`
        });

        // Add to batch for real-time notification
        alertsToSend.push({
          userId: user.id,
          symbol,
          currentPrice,
          targetPrice,
          condition,
          assetName
        });

        // Send email notification if enabled
        const emailEnabled = user.notification_preferences?.email?.priceAlerts !== false;
        if (emailEnabled) {
          await emailService.sendNotificationEmail(user, {
            type: 'price_alert_triggered',
            title: `Price Alert Triggered - ${symbol}`,
            data: {
              symbol,
              assetName,
              condition,
              targetPrice,
              currentPrice
            }
          });
        }

        logger.info(`Price alert triggered for user ${user.id}:`, {
          symbol,
          condition,
          targetPrice,
          currentPrice,
          alertId: alert.id
        });
      } catch (error) {
        logger.error(`Error processing triggered alert ${alert.id}:`, error);
      }
    }

    // Send all alerts in batch
    if (alertsToSend.length > 0) {
      await batchNotificationProcessor.sendPriceAlerts(alertsToSend);
      logger.info(`Batched ${alertsToSend.length} price alerts for processing`);
    }
  }

  async triggerAlert(alert, currentPrice) {
    const user = alert.User;
    const { symbol, condition, targetPrice, assetName } = alert.metadata;

    // Deactivate the alert
    await alert.update({
      metadata: {
        ...alert.metadata,
        active: false,
        triggeredAt: new Date().toISOString(),
        triggerPrice: currentPrice
      },
      is_read: false // Mark as unread so user sees the notification
    });

    // Create triggered alert notification
    await Notification.create({
      user_id: user.id,
      type: 'price_alert_triggered',
      title: `Price Alert Triggered - ${symbol}`,
      message: `${symbol} has ${condition.replace('_', ' ')} your target price of $${targetPrice}. Current price: $${currentPrice.toFixed(2)}`,
      priority: 'high',
      is_read: false,
      metadata: {
        symbol,
        assetName,
        condition,
        targetPrice,
        currentPrice,
        originalAlertId: alert.id,
        triggeredAt: new Date().toISOString()
      },
      action_url: `/stocks/${symbol}`
    });

    // Send email notification if enabled
    const emailEnabled = user.notification_preferences?.email?.priceAlerts !== false;
    if (emailEnabled) {
      await emailService.sendNotificationEmail(user, {
        type: 'price_alert_triggered',
        title: `Price Alert Triggered - ${symbol}`,
        data: {
          symbol,
          assetName,
          condition,
          targetPrice,
          currentPrice
        }
      });
    }

    logger.info(`Price alert triggered for user ${user.id}:`, {
      symbol,
      condition,
      targetPrice,
      currentPrice,
      alertId: alert.id
    });
  }

  async createAlert(userId, { symbol, condition, targetPrice, notificationMethod = 'both' }) {
    try {
      // Verify symbol and get current price
      const [asset, quote] = await Promise.all([
        alpacaService.getAsset(symbol),
        alpacaService.getLatestQuote(symbol)
      ]);

      const currentPrice = quote.ap || quote.bp;

      const alert = await Notification.create({
        user_id: userId,
        type: 'price_alert',
        title: `Price Alert for ${symbol}`,
        message: `Alert when ${symbol} ${condition.replace('_', ' ')} $${targetPrice}`,
        priority: 'medium',
        is_read: false,
        metadata: {
          symbol,
          assetName: asset.name,
          condition,
          targetPrice: parseFloat(targetPrice),
          currentPrice,
          notificationMethod,
          active: true,
          createdAt: new Date().toISOString(),
          lastChecked: new Date().toISOString()
        }
      });

      logger.info('Price alert created:', {
        userId,
        symbol,
        condition,
        targetPrice,
        currentPrice,
        alertId: alert.id
      });

      return alert;
    } catch (error) {
      logger.error('Error creating price alert:', error);
      throw error;
    }
  }

  async getActiveAlertsCount() {
    return await Notification.count({
      where: {
        type: 'price_alert',
        'metadata.active': true
      }
    });
  }

  async getUserAlertsCount(userId) {
    return await Notification.count({
      where: {
        user_id: userId,
        type: 'price_alert',
        'metadata.active': true
      }
    });
  }

  async cleanupTriggeredAlerts(daysOld = 30) {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysOld);

      const deletedCount = await Notification.destroy({
        where: {
          type: 'price_alert_triggered',
          created_at: {
            [Notification.sequelize.Sequelize.Op.lt]: cutoffDate
          }
        }
      });

      if (deletedCount > 0) {
        logger.info(`Cleaned up ${deletedCount} old triggered price alerts`);
      }

      return deletedCount;
    } catch (error) {
      logger.error('Error cleaning up triggered alerts:', error);
      throw error;
    }
  }

  async getAlertStats() {
    try {
      const [totalActive, totalTriggered, alertsBySymbol] = await Promise.all([
        Notification.count({
          where: {
            type: 'price_alert',
            'metadata.active': true
          }
        }),
        Notification.count({
          where: {
            type: 'price_alert_triggered'
          }
        }),
        Notification.findAll({
          where: {
            type: 'price_alert',
            'metadata.active': true
          },
          attributes: ['metadata'],
          raw: true
        })
      ]);

      const symbolCounts = {};
      alertsBySymbol.forEach(alert => {
        const symbol = alert.metadata.symbol;
        symbolCounts[symbol] = (symbolCounts[symbol] || 0) + 1;
      });

      const topSymbols = Object.entries(symbolCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([symbol, count]) => ({ symbol, count }));

      return {
        totalActive,
        totalTriggered,
        topSymbols,
        serviceStatus: this.isRunning ? 'running' : 'stopped'
      };
    } catch (error) {
      logger.error('Error getting alert stats:', error);
      throw error;
    }
  }
}

module.exports = new PriceAlertService();